#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_APP="$(cd "$SCRIPT_DIR/../../.." && pwd)"
REPO_ROOT="$(cd "$SOURCE_APP/.." && pwd)"

"$REPO_ROOT/Scripts/build-host-artifact.sh" >/dev/null
"$REPO_ROOT/Scripts/verify-root-apps.sh"
echo "$SOURCE_APP"
