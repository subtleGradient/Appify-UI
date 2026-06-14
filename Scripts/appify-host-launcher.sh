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
ARCHITECTURE="$(appify_host_arch)"
HOST_BINARY="$(appify_host_binary_path "$ROOT" "$ARCHITECTURE")"

if [[ ! -x "$HOST_BINARY" ]]; then
  appify_show_error "Cannot Start $APP_NAME" "Missing AppifyHost artifact for $ARCHITECTURE at ${HOST_BINARY#$ROOT/}. Run Scripts/build-host-artifact.sh from the repo, or use Scripts/eject-app.sh to create a standalone app."
  exit 1
fi

if [[ "${APPIFY_HOST_BOOTSTRAP_ONLY:-0}" == "1" ]]; then
  exit 0
fi

export APPIFY_HOST_BUNDLE_PATH="$APP"
exec "$HOST_BINARY" "$@"
