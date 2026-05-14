#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/dist/Appify UI.app"
EXPECTED_BUNDLE_IDENTIFIER="com.subtlegradient.AppifyUI2026"

if [[ "${APPIFY_SMOKE_SKIP_BUILD:-0}" != "1" ]]; then
  "$ROOT/Scripts/build-app.sh" >/dev/null
fi

if [[ ! -x "$APP/Contents/MacOS/Appify UI" ]]; then
  echo "Missing executable app bundle at $APP" >&2
  exit 1
fi

codesign -vvv --deep --strict "$APP" >/dev/null

"$ROOT/Scripts/smoke-ui.jxa.js" "$APP" "$EXPECTED_BUNDLE_IDENTIFIER"
