#!/usr/bin/env bash
set -euo pipefail

DOCUMENT_PATH="${APPIFY_HOST_DOCUMENT_PATH:?APPIFY_HOST_DOCUMENT_PATH is required}"
PREVIEW_HTML="$DOCUMENT_PATH/QuickLook/Preview.html"

if [[ ! -f "$PREVIEW_HTML" ]]; then
  printf 'Hello.app expected %s\n' "$PREVIEW_HTML" >&2
  exit 1
fi

url_encode_path() {
  local input="$1"
  local output=""
  local char hex i

  LC_ALL=C
  for ((i = 0; i < ${#input}; i += 1)); do
    char="${input:i:1}"
    case "$char" in
      [a-zA-Z0-9._~-]|/)
        output+="$char"
        ;;
      *)
        printf -v hex '%%%02X' "'$char"
        output+="$hex"
        ;;
    esac
  done

  printf '%s\n' "$output"
}

printf 'APPIFY_HOST_OPEN_URL=file://%s\n' "$(url_encode_path "$PREVIEW_HTML")"

while true; do
  sleep 3600 &
  wait $!
done
