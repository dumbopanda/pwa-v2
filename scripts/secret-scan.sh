#!/usr/bin/env bash
# Scans tracked + staged files for likely secrets. Prints file:line and the
# rule name only, never the matched value. Exit 1 on any hit.
# ponytail: regex rules only; swap for gitleaks when it can be installed.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
rules=(
  'anthropic_key|sk-ant-[A-Za-z0-9_-]{20,}'
  'supabase_secret_key|sb_secret_[A-Za-z0-9_-]{20,}'
  'jwt|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.'
  'aws_key|AKIA[0-9A-Z]{16}'
  'google_api_key|AIza[0-9A-Za-z_-]{35}'
  'google_oauth_secret|GOCSPX-[A-Za-z0-9_-]{20,}'
  'private_key|-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'github_token|gh[pousr]_[A-Za-z0-9]{30,}'
  'assigned_secret|(password|passwd|secret|api_?key|token|pepper)["'"'"' ]*[:=][ ]*["'"'"'][^"'"'"' ]{8,}["'"'"']'
)
hits=0
files=$(git ls-files -co --exclude-standard)
for r in "${rules[@]}"; do
  name=${r%%|*}; re=${r#*|}
  while IFS=: read -r f l _; do
    [ -n "$f" ] || continue
    echo "HIT $name $f:$l"; hits=$((hits+1))
  done < <(grep -nIE -i -- "$re" $files 2>/dev/null | grep -vE '"env\([A-Z0-9_]+\)"' | cut -d: -f1,2)
done
[ $hits -eq 0 ] && echo "secret scan: clean ($(wc -w <<<"$files") files)" || { echo "secret scan: $hits hit(s)"; exit 1; }
