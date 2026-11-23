#!/usr/bin/env bash
# Flags statements in new migrations that can remove or rewrite user data, including inside
# function bodies that only run later. A flagged line passes only with a reason on it:
#   delete from email_otps where ...;   -- data-safe: only expired sign-in codes
# Migrations up to BASELINE were reviewed by hand before this check existed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE="${BASELINE:-0021}"
RISKY='\b(drop[[:space:]]+(table|column|schema|view|function|trigger|policy)|truncate|delete[[:space:]]+from|update[[:space:]]+[a-z_.]+[[:space:]]+set|alter[[:space:]]+column[[:space:]]+[a-z_]+[[:space:]]+(set[[:space:]]+data[[:space:]]+)?type|rename|disable[[:space:]]+row[[:space:]]+level|security[[:space:]]+definer)\b'
bad=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  n="$(basename "$f" | cut -c1-4)"; [[ "$n" > "$BASELINE" ]] || continue
  while IFS= read -r hit; do
    grep -qi -- '-- data-safe:' <<<"$hit" && continue
    echo "$(basename "$f"):$hit"; bad=1
  done < <(perl -pe 's/--(?! data-safe:).*$//' "$f" | grep -n -i -E "$RISKY" || true)
done
if (( bad )); then echo "Risky lines above need '-- data-safe: <reason>' after a review."; exit 1; fi
echo "migration guard: ok"
