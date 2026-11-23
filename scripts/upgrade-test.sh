#!/usr/bin/env bash
# Data-safety test for a release. Builds prod's schema as it is today (migrations up to FROM),
# loads realistic user data, then applies the new migrations and checks no row disappeared.
#   sudo -u postgres scripts/upgrade-test.sh 0021      # FROM = last migration already on prod
# FAIL: any table lost rows or columns, or a migration errored. CHANGED: rows edited; read why before release.
set -euo pipefail
FROM="${1:?usage: upgrade-test.sh <last migration on prod, e.g. 0021>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
DATA="$(mktemp -d)"; PORT="${PORT:-54398}"
trap '"$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT
"$PG_BIN/initdb" -D "$DATA" -A trust -U postgres >/dev/null
"$PG_BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=''" -l "$DATA/log" -w start >/dev/null
PSQL=(psql -h "$DATA" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$ROOT/scripts/standin.sql"

new=()
for f in "$ROOT"/supabase/migrations/*.sql; do
  n="$(basename "$f" | cut -c1-4)"
  if [[ "$n" > "$FROM" ]]; then new+=("$f"); continue; fi
  "${PSQL[@]}" -f "$f" >/dev/null || { echo "FAIL: old migration $(basename "$f")"; exit 1; }
done
[[ ${#new[@]} -gt 0 ]] || { echo "No new migrations after $FROM. Nothing to test."; exit 0; }

"${PSQL[@]}" -f "$ROOT/scripts/seed-upgrade.sql" >/dev/null || { echo "FAIL: seed no longer loads on the $FROM schema; update scripts/seed-upgrade.sql"; exit 1; }
before="$("${PSQL[@]}" -t -A -F'|' -f "$ROOT/scripts/fingerprint.sql")"
for f in "${new[@]}"; do
  "${PSQL[@]}" -f "$f" >/dev/null || { echo "FAIL: new migration $(basename "$f") errors on real data"; exit 1; }
  echo "applied $(basename "$f")"
done
after="$("${PSQL[@]}" -t -A -F'|' -f "$ROOT/scripts/fingerprint.sql")"

fail=0
while IFS='|' read -r t r c h; do
  a="$(grep "^$t|" <<<"$after" || true)"
  if [[ -z "$a" ]]; then echo "FAIL $t: table gone ($r rows)"; fail=1; continue; fi
  ar="$(cut -d'|' -f2 <<<"$a")"; ac="$(cut -d'|' -f3 <<<"$a")"; ah="$(cut -d'|' -f4 <<<"$a")"
  if (( ar < r )); then echo "FAIL $t: $r -> $ar rows"; fail=1
  elif (( ac < c )); then echo "FAIL $t: a column was dropped ($c -> $ac)"; fail=1
  elif [[ "$ah" != "$h" ]]; then echo "CHANGED $t: $r -> $ar rows, content edited"
  else echo "ok   $t: $r rows"; fi
done <<<"$before"
exit $fail
