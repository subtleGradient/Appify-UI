#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"

TLCANVAS_APP_OUTPUT="$REPO_ROOT/TLCanvas.app" \
TLCANVAS_APP_SIGN=0 \
"$ROOT/Scripts/build-app.sh"
