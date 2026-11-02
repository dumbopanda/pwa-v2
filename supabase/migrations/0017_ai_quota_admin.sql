-- AI call caps and the owner-only metrics read.
--
-- Event names the app writes (props hold numbers and fixed labels only):
--   app_open       {streak: int}
--   entry_saved    {ms: int, via: 'ai'|'manual'|'sms'}   ms = app open -> saved
--   ai_result      {outcome: 'accepted'|'edited'|'rejected'}
--   review_opened  {}
--   ai_call        {fn: 'parse'|'review'}                 written by ai_take_quota()

insert into public.app_config values
  ('ai_daily_cap',            '50'::jsonb),   -- per user, rolling 24 hours
  ('ai_minute_cap',           '10'::jsonb),   -- per user, rolling 60 seconds
  ('private.admin_user_ids',  '[]'::jsonb);   -- set to your auth user id by hand

-- app_config was readable by every role (0001). Pin it to authenticated and
-- hide private.* keys so no user can read who the admin is.
drop policy app_config_read on public.app_config;
create policy app_config_read on public.app_config for select to authenticated
  using (key not like 'private.%');

-- 1. AI quota. Called by the parse-entry and month-review Edge Functions with
--    the caller's own JWT, before every model call. Security invoker: it can
--    only count and write the caller's own events. A user inserting fake
--    ai_call events only lowers their own quota.
create or replace function public.ai_take_quota(p_fn text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  uid     uuid := auth.uid();
  day_cap int; min_cap int;
  n_day   int; n_min int;
  oldest  timestamptz;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_fn is null or p_fn not in ('parse', 'review') then
    raise exception 'bad_fn' using errcode = '22023';
  end if;

  -- Serialize one user's concurrent calls so two can't both pass the check.
  perform pg_advisory_xact_lock(hashtext('ai_quota:' || uid::text));

  select (value #>> '{}')::int into day_cap from public.app_config where key = 'ai_daily_cap';
  select (value #>> '{}')::int into min_cap from public.app_config where key = 'ai_minute_cap';

  select count(*),
         count(*) filter (where created_at > now() - interval '1 minute'),
         min(created_at) filter (where created_at > now() - interval '1 minute')
    into n_day, n_min, oldest
    from public.events
   where user_id = uid and name = 'ai_call' and created_at > now() - interval '24 hours';

  if n_min >= min_cap then
    return jsonb_build_object('ok', false, 'reason', 'minute_cap',
      'retry_after_s', greatest(1, ceil(extract(epoch from oldest + interval '1 minute' - now()))));
  end if;
  if n_day >= day_cap then
    return jsonb_build_object('ok', false, 'reason', 'daily_cap');
  end if;

  insert into public.events (name, props) values ('ai_call', jsonb_build_object('fn', p_fn));
  return jsonb_build_object('ok', true, 'left_today', day_cap - n_day - 1);
end $$;

-- 2. Owner-only metrics. Security definer so it can aggregate across users;
--    returns counts and averages only, never a row, id, amount or name.
create or replace function public.admin_metrics()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not exists (
       select 1 from public.app_config c, jsonb_array_elements_text(c.value) a(id)
        where c.key = 'private.admin_user_ids' and a.id = uid::text) then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'users', (select count(*) from public.profiles),

    -- entries per user per active day, last 30 days. A transfer counts once;
    -- opening balances don't count.
    'entries_per_user_day', (
      select round(avg(n), 2) from (
        select count(distinct coalesce(transfer_group, id)) n
          from public.entries
         where deleted_at is null and txn_type <> 'Opening balance'
           and created_at > now() - interval '30 days'
         group by user_id, created_at::date) t),

    -- distinct days with an entry, per user per week that had any, last 8 weeks
    'days_with_entry_per_week', (
      select round(avg(n), 2) from (
        select count(distinct entry_date) n
          from public.entries
         where deleted_at is null and txn_type <> 'Opening balance'
           and entry_date > current_date - 56
         group by user_id, date_trunc('week', entry_date)) t),

    -- each user's latest reported streak, last 30 days
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

    -- dN return: of users who signed up at least N days ago, how many opened
    -- the app on or after day N.
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

revoke execute on function public.ai_take_quota(text) from public, anon;
revoke execute on function public.admin_metrics()     from public, anon;
grant  execute on function public.ai_take_quota(text) to authenticated;
grant  execute on function public.admin_metrics()     to authenticated;
