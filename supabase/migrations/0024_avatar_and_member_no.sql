-- Profile page: a picked icon (30 built-in ones, no photos stored) and a founding-member number.
-- The first 200 sign-ups get free access for life: plan 'supporter', no expiry. member_no is
-- handed out once, in sign-up order, and never reused (deleting an account leaves a gap).
-- Existing users are numbered by created_at. The 200 limit is also in web/src/lib/profile.ts.

alter table public.profiles
  add column avatar    text check (avatar is null or avatar in (
    'moon','leaf','wave','cloud','lotus','mountain',
    'flame','bolt','rocket','shield','crown','medal',
    'compass','telescope','book','bulb','puzzle','owl',
    'star','fox','panda','ghost','cat','paw',
    'tree','anchor','coffee','bike','home','key')),
  add column member_no int unique check (member_no is null or member_no > 0);

create sequence public.member_no_seq;
revoke all on sequence public.member_no_seq from public, anon, authenticated;

-- The column guard also keeps member_no (and so the free-for-life status) out of a client's hands.
create or replace function public.protect_profile_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  new.plan                   := old.plan;
  new.entitlement_expires_at := old.entitlement_expires_at;
  new.entry_count            := old.entry_count;
  new.member_no              := old.member_no;
  return new;
end $$;

-- Number the people already here, then let the sequence carry on after them. The guard trigger is
-- paused only for this backfill so plan can be set; it is switched back on in the same migration.
alter table public.profiles disable trigger profiles_protect;
update public.profiles p set member_no = r.n   -- data-safe: fills the new empty member_no column only
  from (select user_id, row_number() over (order by created_at, user_id) as n from public.profiles) r
  where r.user_id = p.user_id;
update public.profiles set plan = 'supporter', entitlement_expires_at = null   -- data-safe: first 200 members get free access for life; only moves free to supporter
  where member_no <= 200 and plan = 'free';
alter table public.profiles enable trigger profiles_protect;
select setval('public.member_no_seq', coalesce((select max(member_no) from public.profiles), 0) + 1, false);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$   -- data-safe: same signup trigger as before; adds the member number
declare n int := nextval('public.member_no_seq');
begin
  insert into public.profiles (user_id, display_name, member_no, plan)
  values (new.id, new.raw_user_meta_data ->> 'full_name', n, case when n <= 200 then 'supporter' else 'free' end)
  on conflict (user_id) do nothing;
  return new;
end $$;
