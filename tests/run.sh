#!/usr/bin/env bash
# Run the core gjs tests (tests/*.test.js) outside the Shell.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export TZ=Europe/Moscow

status=0
for t in tests/*.test.js; do
  [[ -e $t ]] || continue
  echo "== $t"
  timeout 60 gjs -m "$t" || status=1
done
exit $status
