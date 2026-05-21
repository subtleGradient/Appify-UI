#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"

LAZYGIT_APP_OUTPUT="$REPO_ROOT/LazyGit.app" \
LAZYGIT_APP_SIGN=0 \
"$ROOT/Scripts/build-app.sh"
