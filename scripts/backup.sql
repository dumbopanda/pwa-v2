-- Run on prod right before a release (also fine on dev). Copies every user-data table
-- (public schema + auth.users) into a new private schema backup_YYYYMMDD_HHMMSS in the same database,
-- then prints rows copied per table. Keeps the newest 5 backups.
-- Restore one table exactly (triggers off, or they re-stamp timestamps and the copy is no longer exact):
--   begin; set local session_replication_role = replica;
--   insert into public.entries select * from backup_X.public__entries on conflict do nothing; commit;
do $$
declare s text := 'backup_' || to_char(now() at time zone 'UTC', 'YYYYMMDD_HH24MISS'); r record;
begin
  execute format('create schema %I', s);
  execute format('revoke all on schema %I from public, anon, authenticated', s);
  for r in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where c.relkind = 'r' and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users')) loop
    execute format('create table %I.%I as table %I.%I', s, r.nspname || '__' || r.relname, r.nspname, r.relname);
  end loop;
  for r in select nspname from pg_namespace where nspname like 'backup\_%' order by nspname desc offset 5 loop
    execute format('drop schema %I cascade', r.nspname);   -- old backups only
  end loop;
end $$;
-- Check: copied must equal live on every row.
select c.relname as copy,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as copied,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', split_part(c.relname, '__', 1), split_part(c.relname, '__', 2)), false, true, '')))[1]::text::bigint as live,
       n.nspname as backup
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = (select max(nspname) from pg_namespace where nspname like 'backup\_%') and c.relkind = 'r' order by 1;
