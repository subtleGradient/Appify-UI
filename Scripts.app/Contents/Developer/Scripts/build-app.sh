#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_APP="$(cd "$SCRIPT_DIR/../../.." && pwd)"
REPO_ROOT="$(cd "$SOURCE_APP/.." && pwd)"

exec "$REPO_ROOT/Scripts/build-app-from-root.sh" "$SOURCE_APP" "Scripts" "SCRIPTS_APP_OUTPUT" "SCRIPTS_APP_SIGN"
