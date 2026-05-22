#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${JSONCANVAS_SMOKE_APP:-$ROOT/dist/JSONCanvas.app}"
EXPECTED_BUNDLE_IDENTIFIER="com.subtlegradient.jsoncanvas"
SMOKE_SKIP_BUILD="${JSONCANVAS_SMOKE_SKIP_BUILD:-}"

if [[ -z "$SMOKE_SKIP_BUILD" ]]; then
  if [[ -n "${JSONCANVAS_SMOKE_APP:-}" ]]; then
    SMOKE_SKIP_BUILD=1
  else
    SMOKE_SKIP_BUILD=0
  fi
fi

if [[ "$SMOKE_SKIP_BUILD" != "1" ]]; then
  "$ROOT/Scripts/build-app.sh" >/dev/null
fi

if [[ ! -x "$APP/Contents/MacOS/main.sh" || ! -x "$APP/Contents/MacOS/appify-host" ]]; then
  echo "Missing executable app bundle at $APP" >&2
  exit 1
fi

APPIFY_HOST_BOOTSTRAP_ONLY=1 "$APP/Contents/MacOS/main.sh"
"$ROOT/Scripts/smoke-menus.jxa.js" "$APP" "$EXPECTED_BUNDLE_IDENTIFIER" JSONCanvas
echo "JSONCanvas smoke ok: $APP"
