#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APPIFY_HOST_APP_NAME:-LazyGit}"
PACKAGE_PATH="${APPIFY_HOST_DOCUMENT_PATH:?APPIFY_HOST_DOCUMENT_PATH is required}"
WORKING_DIRECTORY="${APPIFY_HOST_WORKING_DIRECTORY:?APPIFY_HOST_WORKING_DIRECTORY is required}"
SERVER_TIMEOUT_SECONDS="${LAZYGIT_APP_SERVER_TIMEOUT_SECONDS:-900}"

if ! [[ "$SERVER_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || [[ "$SERVER_TIMEOUT_SECONDS" -lt 1 ]]; then
  printf 'LAZYGIT_APP_SERVER_TIMEOUT_SECONDS must be a positive integer.\n' >&2
  exit 1
fi

unset DEVELOPER_DIR SDKROOT

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

allocate_port() {
  /usr/bin/python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

random_base_path() {
  local token
  if command -v uuidgen >/dev/null 2>&1; then
    token="$(uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '-')"
  else
    token="$RANDOM$RANDOM$RANDOM"
  fi
  printf '/appify-host-%s\n' "$token"
}

wait_for_port() {
  local port="$1"
  local timeout_seconds="$2"
  /usr/bin/python3 - "$port" "$timeout_seconds" <<'PY'
import socket
import sys
import time

port = int(sys.argv[1])
timeout_seconds = int(sys.argv[2])
deadline = time.time() + timeout_seconds
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

shell_quote() {
  printf '%q' "$1"
}

start_with_nix() {
  local nix_shell="$1"
  local port="$2"
  local base_path="$3"
  local command
  command="unset DEVELOPER_DIR SDKROOT; exec ttyd --interface 127.0.0.1 --port $(shell_quote "$port") --writable --check-origin --once --max-clients 1 --base-path $(shell_quote "$base_path") --cwd $(shell_quote "$WORKING_DIRECTORY") lazygit --path $(shell_quote "$WORKING_DIRECTORY")"
  "$nix_shell" -p ttyd lazygit git git-lfs --run "$command" &
}

start_direct() {
  local port="$1"
  local base_path="$2"
  local ttyd lazygit git git_lfs
  ttyd="$(find_tool ttyd)" || return 1
  lazygit="$(find_tool lazygit)" || return 1
  git="$(find_tool git)" || return 1
  git_lfs="$(find_tool git-lfs)" || return 1
  export PATH="$(dirname "$git"):$(dirname "$git_lfs"):$(dirname "$lazygit"):$(dirname "$ttyd"):${PATH:-}"
  "$ttyd" \
    --interface 127.0.0.1 \
    --port "$port" \
    --writable \
    --check-origin \
    --once \
    --max-clients 1 \
    --base-path "$base_path" \
    --cwd "$WORKING_DIRECTORY" \
    "$lazygit" --path "$WORKING_DIRECTORY" &
}

PORT="$(allocate_port)"
BASE_PATH="$(random_base_path)"
OPEN_URL="http://127.0.0.1:$PORT$BASE_PATH/"
CHILD_PID=""

cleanup() {
  if [[ -n "$CHILD_PID" ]]; then
    kill "$CHILD_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup TERM INT EXIT

if start_direct "$PORT" "$BASE_PATH"; then
  CHILD_PID="$!"
elif NIX_SHELL="$(find_tool nix-shell)"; then
  start_with_nix "$NIX_SHELL" "$PORT" "$BASE_PATH"
  CHILD_PID="$!"
else
  printf '%s requires nix-shell or direct installations of ttyd, lazygit, git, and git-lfs.\n' "$APP_NAME" >&2
  exit 1
fi

if ! wait_for_port "$PORT" "$SERVER_TIMEOUT_SECONDS"; then
  printf '%s terminal server did not become reachable on 127.0.0.1:%s within %s seconds for %s.\n' "$APP_NAME" "$PORT" "$SERVER_TIMEOUT_SECONDS" "$PACKAGE_PATH" >&2
  exit 1
fi

printf 'APPIFY_HOST_OPEN_URL=%s\n' "$OPEN_URL"
wait "$CHILD_PID"
