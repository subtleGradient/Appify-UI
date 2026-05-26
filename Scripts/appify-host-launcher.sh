#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/Scripts/appify-host-lib.sh"

if [[ $# -lt 1 ]]; then
  appify_fail "Usage: appify-host-launcher.sh /path/to/App.app [document ...]"
fi

APP="$(cd "$1" && pwd)"
shift

APP_NAME="$(appify_app_name "$APP")"
SOURCE_DIR="$ROOT/source/AppifyHost"
HOST_BINARY="$ROOT/bin/appify-host"

problem="$(appify_host_artifact_problem "$ROOT" || true)"
if [[ -z "$problem" ]]; then
  host_to_exec="$HOST_BINARY"
elif command -v swift >/dev/null 2>&1; then
  if ! swift build --package-path "$SOURCE_DIR" -c debug --product appify-host; then
    appify_show_error "Cannot Build $APP_NAME" "The checked-in host artifact is stale, and Swift could not build an ephemeral host from source/AppifyHost."
    exit 1
  fi
  host_to_exec="$SOURCE_DIR/.build/debug/appify-host"
else
  appify_show_error "Cannot Start $APP_NAME" "The checked-in AppifyHost artifact is stale: $problem. Run Scripts/build-host-artifact.sh from the repo, or use Scripts/eject-app.sh to create a standalone app."
  exit 1
fi

if [[ "${APPIFY_HOST_BOOTSTRAP_ONLY:-0}" == "1" ]]; then
  exit 0
fi

export APPIFY_HOST_BUNDLE_PATH="$APP"
exec "$host_to_exec" "$@"
