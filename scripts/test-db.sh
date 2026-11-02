#!/usr/bin/env bash
# Runs every migration from scratch on a throwaway local Postgres, then every
# pgTAP file in supabase/tests. No Docker, no Supabase CLI.
# Needs: Postgres server binaries + pgTAP (Ubuntu: postgresql-16 postgresql-16-pgtap).
# Must run as a non-root user (initdb refuses root): sudo -u postgres scripts/test-db.sh
#
# A small stand-in replaces what Supabase provides: the anon/authenticated/
# service_role roles, auth.users, auth.uid(), and an `extensions` schema.
# The real check is re-running supabase/tests on the hosted project.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
DATA="$(mktemp -d)"; PORT="${PORT:-54399}"
trap '"$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT

"$PG_BIN/initdb" -D "$DATA" -A trust -U postgres >/dev/null
"$PG_BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=''" -l "$DATA/log" -w start >/dev/null
PSQL=(psql -h "$DATA" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
create extension pgcrypto with schema extensions;
create extension pgtap    with schema extensions;
alter database postgres set search_path = public, extensions;
create schema auth;
create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz,
  created_at timestamptz, updated_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
grant usage on schema auth, public, extensions to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
SQL

for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$f" || { echo "MIGRATION FAILED: $(basename "$f")"; exit 1; }
done
echo "migrations: $(ls "$ROOT"/supabase/migrations/*.sql | wc -l) applied"

fail=0
for t in "$ROOT"/supabase/tests/*.sql; do
  out="$("${PSQL[@]}" -t -A -f "$t" 2>&1)" || fail=1
  if grep -qE '^not ok|Looks like|ERROR' <<<"$out"; then
    fail=1; echo "FAIL $(basename "$t")"; grep -E '^not ok|^#|ERROR' <<<"$out"
  else
    echo "ok   $(basename "$t") ($(grep -c '^ok' <<<"$out") tests)"
  fi
done
exit $fail
