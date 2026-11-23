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

"${PSQL[@]}" -f "$ROOT/scripts/standin.sql"
"${PSQL[@]}" -c 'create extension pgtap with schema extensions;'

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
