#!/usr/bin/env bash
# Flags statements in new migrations that can remove or rewrite user data, including inside
# function bodies that only run later. Reads whole statements, so line breaks don't hide them.
# A flagged statement passes only with a reason right after its semicolon:
#   delete from email_otps where ...;   -- data-safe: only expired sign-in codes
# Migrations up to BASELINE were reviewed by hand before this check existed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE="${BASELINE:-0021}"
bad=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  n="$(basename "$f" | cut -c1-4)"; [[ "$n" > "$BASELINE" ]] || continue
  perl -0777 -ne '
    s/--(?! data-safe:)[^\n]*//g;                       # drop comments, keep data-safe notes
    my @parts = split /;/;
    my $risky = qr/
        \b(?:drop\s+(?:table|column|schema|view|materialized|function|procedure|trigger|policy|type|owned)\b
        | truncate\b
        | delete\s+from\b
        | update\s+(?:only\s+)?[\w."]+\s+(?:as\s+\w+\s+)?set\b
        | merge\s+into\b
        | alter\s+table\b[^;]*?\bdrop\s+(?!constraint\b|default\b|not\s+null\b|identity\b|expression\b)\w
        | alter\s+column\s+\S+\s+(?:set\s+data\s+)?type\b
        | rename\b
        | on\s+delete\s+(?:cascade|set\s+null|set\s+default)\b
        | disable\s+row\s+level
        | no\s+force\s+row\s+level
        | security\s+definer\b)/xi;
    for my $i (0..$#parts) {
      my $s = $parts[$i]; $s =~ s/^[ \t]*-- data-safe:[^\n]*//;   # that note belongs to the previous statement
      $s =~ s/\s+/ /g;
      next unless $s =~ $risky;
      my $next = $i < $#parts ? $parts[$i+1] : "";
      next if $s =~ /-- data-safe:/ or $next =~ /^[ \t]*-- data-safe:/;
      $s =~ s/^ +//; print "'"$(basename "$f")"': ", substr($s, 0, 140), "\n";
      $main::bad = 1;
    }
    exit($main::bad ? 1 : 0);
  ' "$f" || bad=1
done
if (( bad )); then echo "Risky statements above need '-- data-safe: <reason>' after a review."; exit 1; fi
echo "migration guard: ok"
