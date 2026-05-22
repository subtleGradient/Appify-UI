#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_APP="$(cd "$SCRIPT_DIR/../../.." && pwd)"
REPO_ROOT="$(cd "$SOURCE_APP/.." && pwd)"

exec "$REPO_ROOT/Scripts/build-app-from-root.sh" "$SOURCE_APP" "WebFormer" "WEBFORMER_APP_OUTPUT" "WEBFORMER_APP_SIGN"
