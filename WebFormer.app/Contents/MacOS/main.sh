#!/usr/bin/env bash
set -euo pipefail

APP="$(cd "$(dirname "$0")/../.." && pwd)"
cursor="$APP"
while [[ "$cursor" != "/" ]]; do
  launcher="$cursor/Scripts/appify-host-launcher.sh"
  if [[ -x "$launcher" ]]; then
    exec "$launcher" "$APP" "$@"
  fi
  cursor="$(dirname "$cursor")"
done

printf 'Cannot find Appify UI repo launcher for %s. Use Scripts/eject-app.sh to create a standalone app.\n' "$APP" >&2
exit 1
