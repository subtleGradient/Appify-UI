#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${TLCANVAS_SMOKE_APP:-$ROOT/dist/TLCanvas.app}"
EXPECTED_BUNDLE_IDENTIFIER="com.subtlegradient.tlcanvas"
SMOKE_SKIP_BUILD="${TLCANVAS_SMOKE_SKIP_BUILD:-}"

if [[ -z "$SMOKE_SKIP_BUILD" ]]; then
  if [[ -n "${TLCANVAS_SMOKE_APP:-}" ]]; then
    SMOKE_SKIP_BUILD=1
  else
    SMOKE_SKIP_BUILD=0
  fi
fi

if [[ "$SMOKE_SKIP_BUILD" != "1" ]]; then
  "$ROOT/Scripts/build-app.sh" >/dev/null
fi

if [[ ! -x "$APP/Contents/MacOS/appify-host" ]]; then
  echo "Missing executable app bundle at $APP" >&2
  exit 1
fi

"$ROOT/Scripts/smoke-menus.jxa.js" "$APP" "$EXPECTED_BUNDLE_IDENTIFIER"
echo "TLCanvas smoke ok: $APP"
