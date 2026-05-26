#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/Scripts/appify-host-lib.sh"

if [[ $# -ne 4 ]]; then
  appify_fail "Usage: build-app-from-root.sh <Source.app> <AppName> <OutputEnv> <SignEnv>"
fi

SOURCE_APP="$(cd "$1" && pwd)"
APP_NAME="$2"
OUTPUT_ENV="$3"
SIGN_ENV="$4"
DEVELOPER_ROOT="$SOURCE_APP/Contents/Developer"

output_value="${!OUTPUT_ENV:-}"
output="${output_value:-$DEVELOPER_ROOT/dist/$APP_NAME.app}"
sign_value="${!SIGN_ENV:-1}"

sign_args=(--sign -)
case "$sign_value" in
  0|false|FALSE|no|NO)
    sign_args=(--no-sign)
    ;;
  1|true|TRUE|yes|YES|-)
    sign_args=(--sign -)
    ;;
  *)
    sign_args=(--sign "$sign_value")
    ;;
esac

exec "$ROOT/Scripts/eject-app.sh" "$SOURCE_APP" --output "$output" "${sign_args[@]}"
