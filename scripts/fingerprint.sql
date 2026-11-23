-- Read-only. Rows and a content hash for every user-data table (public schema + auth.users).
-- Run before and after a release: rows and columns must never go down.
select n.nspname || '.' || c.relname as tbl,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as rows,
       (select count(*) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as cols,
       left((xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(t::text, '','' order by t::text), '''')) as h from %I.%I t', n.nspname, c.relname), false, true, '')))[1]::text, 12) as hash
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users'))
order by 1;
