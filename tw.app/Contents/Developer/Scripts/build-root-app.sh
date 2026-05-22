#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEVELOPER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_CONTENTS="$(cd "$DEVELOPER_ROOT/.." && pwd)"
SOURCE_APP="$(cd "$SOURCE_CONTENTS/.." && pwd)"

find_repo_root() {
  local dir="$SOURCE_APP"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/source/AppifyHost/Package.swift" ]]; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  echo "Could not find repo root containing source/AppifyHost" >&2
  return 1
}

REPO_ROOT="$(find_repo_root)"

TW_APP_OUTPUT="$REPO_ROOT/tw.app" \
TW_APP_SIGN=0 \
"$SCRIPT_DIR/build-app.sh"
