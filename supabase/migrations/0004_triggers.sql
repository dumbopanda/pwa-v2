-- Timestamps are the server's, always. A phone with a wrong clock must not
-- be able to poison sync ordering — updated_at is the tiebreaker for
-- last-write-wins, so a client that can set it can win every conflict forever.
create or replace function public.stamp_timestamps() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;   -- immutable after insert
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger entries_stamp  before insert or update on public.entries
  for each row execute function public.stamp_timestamps();
create trigger accounts_stamp before insert or update on public.accounts
  for each row execute function public.stamp_timestamps();

-- Transfer delete cascade. Deleting one leg deletes its sibling. In the
-- database, because the client is the untrusted part.
create or replace function public.cascade_transfer_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null
     and new.transfer_group is not null then
    update public.entries
       set deleted_at = new.deleted_at
     where transfer_group = new.transfer_group
       and user_id       = new.user_id
       and id           <> new.id
       and deleted_at is null;
  end if;
  return new;
end $$;

create trigger entries_cascade_transfer_delete
  after update of deleted_at on public.entries
  for each row execute function public.cascade_transfer_delete();

-- Transfer pair integrity, checked at commit so both legs can be inserted
-- in one transaction.
create or replace function public.check_transfer_group() returns trigger
language plpgsql as $$
declare
  legs int; debits int; credits int; amounts int; dates int;
begin
  if coalesce(new.transfer_group, old.transfer_group) is null then return null; end if;

  select count(*), count(*) filter (where direction='debit'),
         count(*) filter (where direction='credit'),
         count(distinct amount_minor), count(distinct entry_date)
    into legs, debits, credits, amounts, dates
  from public.entries
  where transfer_group = coalesce(new.transfer_group, old.transfer_group)
    and deleted_at is null;

  if legs = 0 then return null; end if;                    -- both deleted, fine
  if legs <> 2 or debits <> 1 or credits <> 1
     or amounts <> 1 or dates <> 1 then
    raise exception 'transfer_group must be exactly one debit and one credit '
                    'of equal amount and date' using errcode = 'P0001';
  end if;
  return null;
end $$;

create constraint trigger entries_transfer_integrity
  after insert or update or delete on public.entries
  deferrable initially deferred
  for each row execute function public.check_transfer_group();

-- Row cap, maintained as a counter rather than a count(*) on every insert.
create or replace function public.maintain_entry_count() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap int;
begin
  if tg_op = 'INSERT' then
    select (value #>> '{}')::int into cap from public.app_config
      where key = 'max_entries_per_user';
    if (select entry_count from public.profiles where user_id = new.user_id) >= cap then
      raise exception 'entry_limit_reached' using errcode = 'P0002';
    end if;
    update public.profiles set entry_count = entry_count + 1 where user_id = new.user_id;
  end if;
  return null;
end $$;

create trigger entries_count after insert on public.entries
  for each row execute function public.maintain_entry_count();

-- Profile bootstrap — a row must exist before the first entry, so create it
-- at signup.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
