#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APPIFY_HOST_APP_NAME:-WikiDock}"
APP="${APPIFY_HOST_BUNDLE_PATH:?APPIFY_HOST_BUNDLE_PATH is required}"
DOCUMENT_PATH="${APPIFY_HOST_DOCUMENT_PATH:?APPIFY_HOST_DOCUMENT_PATH is required}"

find_tool() {
  local name="$1"
  local candidates=(
    "$HOME/.nix-profile/bin/$name"
    "/nix/var/nix/profiles/default/bin/$name"
    "/run/current-system/sw/bin/$name"
    "/opt/homebrew/bin/$name"
    "/usr/local/bin/$name"
    "/usr/bin/$name"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
    return 0
  fi

  return 1
}

shell_quote() {
  printf '%q' "$1"
}

allocate_port() {
  /usr/bin/python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

wait_for_port() {
  local port="$1"
  /usr/bin/python3 - "$port" <<'PY'
import socket
import sys
import time

port = int(sys.argv[1])
deadline = time.time() + 20
while time.time() < deadline:
    sock = socket.socket()
    sock.settimeout(0.2)
    try:
        sock.connect(("127.0.0.1", port))
        sock.close()
        sys.exit(0)
    except OSError:
        sock.close()
        time.sleep(0.1)
sys.exit(1)
PY
}

meaningful_package_entry() {
  find "$DOCUMENT_PATH" \
    -mindepth 1 \
    -maxdepth 1 \
    ! -name '.DS_Store' \
    ! -name '.localized' \
    ! -name 'QuickLook' \
    -print \
    -quit
}

initialize_empty_wiki_folder() {
  mkdir -p "$DOCUMENT_PATH/tiddlers"
  cat > "$DOCUMENT_PATH/tiddlywiki.info" <<'JSON'
{
  "plugins": [
    "tiddlywiki/tiddlyweb",
    "tiddlywiki/filesystem"
  ],
  "themes": [
    "tiddlywiki/vanilla",
    "tiddlywiki/snowwhite"
  ],
  "build": {
    "index": [
      "--render",
      "$:/core/save/all",
      "index.html",
      "text/plain"
    ]
  },
  "config": {
    "default-tiddler-location": "tiddlers",
    "retain-original-tiddler-path": true
  }
}
JSON
}

ensure_wiki_folder() {
  if [[ ! -d "$DOCUMENT_PATH" ]]; then
    printf '%s expected a .tiddlywiki document package directory: %s\n' "$APP_NAME" "$DOCUMENT_PATH" >&2
    exit 1
  fi

  if [[ -f "$DOCUMENT_PATH/tiddlywiki.info" ]]; then
    mkdir -p "$DOCUMENT_PATH/tiddlers"
    return 0
  fi

  if [[ -z "$(meaningful_package_entry)" ]]; then
    initialize_empty_wiki_folder
    return 0
  fi

  printf '%s only opens TiddlyWiki folder packages with tiddlywiki.info. It does not open arbitrary folders or HTML files.\n' "$APP_NAME" >&2
  exit 1
}

write_nix_tiddlywiki_wrapper() {
  local nix_shell="$1"
  local cache_root="${XDG_CACHE_HOME:-$HOME/Library/Caches}"
  local wrapper_dir="$cache_root/Appify-UI/WikiDock"
  local wrapper="$wrapper_dir/tiddlywiki-via-nix.sh"

  mkdir -p "$wrapper_dir"
  cat > "$wrapper" <<WRAPPER
#!/usr/bin/env bash
set -euo pipefail

nix_shell=$(printf '%q' "$nix_shell")
command="tiddlywiki"
for arg in "\$@"; do
  command="\$command \$(printf '%q' "\$arg")"
done

exec "\$nix_shell" -p tiddlywiki --run "\$command"
WRAPPER
  chmod +x "$wrapper"
  printf '%s\n' "$wrapper"
}

resolve_tiddlywiki() {
  local candidates=()
  if [[ -n "${APPIFY_HOST_TIDDLYWIKI:-}" ]]; then
    candidates+=("$APPIFY_HOST_TIDDLYWIKI")
  fi
  candidates+=(
    "$APP/Contents/MacOS/tiddlywiki"
    "$HOME/.npm-global/bin/tiddlywiki"
    "$HOME/.local/bin/tiddlywiki"
    "/opt/homebrew/bin/tiddlywiki"
    "/usr/local/bin/tiddlywiki"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v tiddlywiki >/dev/null 2>&1; then
    command -v tiddlywiki
    return 0
  fi

  local nix_shell
  if nix_shell="$(find_tool nix-shell)"; then
    write_nix_tiddlywiki_wrapper "$nix_shell"
    return 0
  fi

  return 1
}

start_tiddlywiki() {
  local tiddlywiki="$1"
  local port="$2"

  "$tiddlywiki" \
    +plugins/tiddlywiki/filesystem \
    +plugins/tiddlywiki/tiddlyweb \
    "$DOCUMENT_PATH" \
    --listen \
    host=127.0.0.1 \
    port="$port" &
}

ensure_wiki_folder

if ! TIDDLYWIKI="$(resolve_tiddlywiki)"; then
  printf '%s requires the TiddlyWiki Node.js CLI. Install it, install Nix, or set APPIFY_HOST_TIDDLYWIKI.\n' "$APP_NAME" >&2
  exit 1
fi

PORT="$(allocate_port)"
OPEN_URL="http://127.0.0.1:$PORT/"
CHILD_PID=""

cleanup() {
  if [[ -n "$CHILD_PID" ]]; then
    kill "$CHILD_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup TERM INT EXIT

start_tiddlywiki "$TIDDLYWIKI" "$PORT"
CHILD_PID="$!"

if ! wait_for_port "$PORT"; then
  printf '%s TiddlyWiki server did not become reachable on 127.0.0.1:%s for %s.\n' "$APP_NAME" "$PORT" "$DOCUMENT_PATH" >&2
  exit 1
fi

printf 'APPIFY_HOST_OPEN_URL=%s\n' "$OPEN_URL"
wait "$CHILD_PID"
