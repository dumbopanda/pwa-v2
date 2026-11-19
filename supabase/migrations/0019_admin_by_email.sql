-- Owner access to admin_metrics() by confirmed email, so deleting and re-creating the
-- account (new user id) doesn't lock the owner out. The email itself is data, not code:
-- set it in the database, never in a migration (this repo is public):
--   insert into public.app_config values ('private.admin_emails', '["owner@example.com"]')
--   on conflict (key) do update set value = excluded.value;
-- The old id list still works too.

insert into public.app_config values ('private.admin_emails', '[]'::jsonb)
on conflict (key) do nothing;

create or replace function public.admin_metrics()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare
  uid   uuid := auth.uid();
  mail  text;
  ok    boolean := false;
begin
  if uid is not null then
    -- Only a confirmed address counts, looked up from the account itself, not from anything
    -- the caller sends.
    select lower(u.email) into mail from auth.users u where u.id = uid and u.email_confirmed_at is not null;
    -- Only the two list rows are expanded (other config rows are plain numbers, which can't be).
    select exists (select 1
                     from (select key, value from public.app_config where key in ('private.admin_user_ids', 'private.admin_emails')
                              and jsonb_typeof(value) = 'array') c,
                          jsonb_array_elements_text(c.value) a(v)
                    where (c.key = 'private.admin_user_ids' and a.v = uid::text)
                       or (c.key = 'private.admin_emails' and mail is not null and lower(a.v) = mail))
      into ok;
  end if;
  if not ok then raise exception 'not_admin' using errcode = '42501'; end if;

  return jsonb_build_object(
    'generated_at', now(),
    'users', (select count(*) from public.profiles),
    'entries_per_user_day', (
      select round(avg(n), 2) from (
        select count(distinct coalesce(transfer_group, id)) n
          from public.entries
         where deleted_at is null and txn_type <> 'Opening balance'
           and created_at > now() - interval '30 days'
         group by user_id, created_at::date) t),
    'days_with_entry_per_week', (
      select round(avg(n), 2) from (
        select count(distinct entry_date) n
          from public.entries
         where deleted_at is null and txn_type <> 'Opening balance'
           and entry_date > current_date - 56
         group by user_id, date_trunc('week', entry_date)) t),
    'streak', (
      select jsonb_build_object('avg', round(avg(s), 1), 'max', max(s), 'users', count(*))
        from (select distinct on (user_id) (props->>'streak')::int s
                from public.events
               where name = 'app_open' and props->>'streak' ~ '^\d{1,5}$'
                 and created_at > now() - interval '30 days'
               order by user_id, created_at desc) t),
    'open_to_save_ms_median', (
      select percentile_cont(0.5) within group (order by (props->>'ms')::bigint)
        from public.events
       where name = 'entry_saved' and props->>'ms' ~ '^\d{1,9}$'
         and created_at > now() - interval '30 days'),
    'ai_outcomes_30d', coalesce((
      select jsonb_object_agg(outcome, n) from (
        select props->>'outcome' outcome, count(*) n
          from public.events
         where name = 'ai_result'
           and props->>'outcome' in ('accepted', 'edited', 'rejected')
           and created_at > now() - interval '30 days'
         group by 1) t), '{}'::jsonb),
    'retention', coalesce((
      select jsonb_object_agg('d' || d, jsonb_build_object('eligible', eligible, 'returned', returned))
        from (select v.d, count(*) eligible,
                     count(*) filter (where exists (
                       select 1 from public.events e
                        where e.user_id = p.user_id and e.name = 'app_open'
                          and e.created_at >= p.created_at + make_interval(days => v.d))) returned
                from (values (1), (7), (30)) v(d)
                join public.profiles p on p.created_at <= now() - make_interval(days => v.d)
               group by v.d) t), '{}'::jsonb),
    'review_opened_90d', (
      select jsonb_build_object('times', count(*), 'users', count(distinct user_id))
        from public.events
       where name = 'review_opened' and created_at > now() - interval '90 days')
  );
end $$;

revoke execute on function public.admin_metrics() from public, anon;
grant  execute on function public.admin_metrics() to authenticated;
