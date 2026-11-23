-- Read-only. Run on dev and prod; the rows must match for every object both should have.
-- Catches changes made by hand that never went through a migration (drift).
-- Comments, spacing and line endings are ignored.
select kind, name, left(md5(def), 10) as hash from (
  select 'function' as kind, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
         regexp_replace(regexp_replace(replace(pg_get_functiondef(p.oid), chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g') as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select 'columns', table_name, string_agg(column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, ''), ', ' order by column_name)
  from information_schema.columns where table_schema = 'public' group by table_name
  union all
  select 'policy', tablename || '.' || policyname, cmd || ' ' || array_to_string(roles, ',') || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
  from pg_policies where schemaname = 'public'
  union all
  select 'trigger', c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal
  union all
  select 'constraint', c.relname || '.' || k.conname, pg_get_constraintdef(k.oid)
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
) x order by 1, 2;
