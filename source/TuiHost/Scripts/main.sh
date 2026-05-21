#!/usr/bin/env bash
set -euo pipefail

APP="$(cd "$(dirname "$0")/../.." && pwd)"
INFO_PLIST="$APP/Contents/Info.plist"
HOST_BINARY="$APP/Contents/MacOS/tui-host"
PLIST_BUDDY="/usr/libexec/PlistBuddy"

read_plist() {
  "$PLIST_BUDDY" -c "Print :$1" "$INFO_PLIST" 2>/dev/null || true
}

show_error() {
  local title="$1"
  local message="$2"
  if command -v osascript >/dev/null 2>&1; then
    osascript - "$title" "$message" >/dev/null 2>&1 <<'APPLESCRIPT' || true
on run argv
  display dialog (item 2 of argv) with title (item 1 of argv) buttons {"OK"} default button "OK"
end run
APPLESCRIPT
  fi
  printf '%s: %s\n' "$title" "$message" >&2
}

app_name() {
  local display_name bundle_name
  display_name="$(read_plist "CFBundleDisplayName")"
  bundle_name="$(read_plist "CFBundleName")"
  if [[ -n "$display_name" ]]; then
    printf '%s\n' "$display_name"
  elif [[ -n "$bundle_name" ]]; then
    printf '%s\n' "$bundle_name"
  else
    basename "$APP" .app
  fi
}

find_repo_source() {
  local cursor="$APP"
  while [[ "$cursor" != "/" ]]; do
    if [[ -d "$cursor/source/TuiHost" && -f "$cursor/source/TuiHost/Package.swift" ]]; then
      printf '%s\n' "$cursor/source/TuiHost"
      return 0
    fi
    cursor="$(dirname "$cursor")"
  done
  return 1
}

source_newer_than_reference() {
  local source_dir="$1"
  local reference_file="$2"
  if [[ ! -e "$reference_file" ]]; then
    return 0
  fi

  while IFS= read -r source_file; do
    if [[ "$source_file" -nt "$reference_file" ]]; then
      return 0
    fi
  done < <(find "$source_dir" -type f \( -name "Package.swift" -o -name "*.swift" \) -print)

  return 1
}

rebuild_host_if_needed() {
  local source_dir="$1"
  local reference_file="$HOST_BINARY"
  local bundled_source_stamp="$APP/Contents/Resources/TuiHostSource/.tui-host-built-at"

  if [[ "$source_dir" == "$APP/Contents/Resources/TuiHostSource" && -e "$bundled_source_stamp" ]]; then
    reference_file="$bundled_source_stamp"
  fi

  if [[ -x "$HOST_BINARY" ]] && ! source_newer_than_reference "$source_dir" "$reference_file"; then
    return 0
  fi

  if ! command -v swift >/dev/null 2>&1; then
    show_error "Cannot Rebuild $(app_name)" "Swift is not installed, and the bundled tui-host binary is older than the Swift source. Install Xcode command line tools or restore a fresh app bundle."
    exit 1
  fi

  swift build --package-path "$source_dir" -c debug --product tui-host
  local built_binary="$source_dir/.build/debug/tui-host"
  if [[ ! -x "$built_binary" ]]; then
    show_error "Cannot Rebuild $(app_name)" "Swift build completed without producing $built_binary."
    exit 1
  fi

  cp "$built_binary" "$HOST_BINARY"
  chmod +x "$HOST_BINARY"
  if [[ "$source_dir" == "$APP/Contents/Resources/TuiHostSource" ]]; then
    touch "$bundled_source_stamp"
  fi
}

APP_NAME="$(app_name)"
BUNDLED_SOURCE="$APP/Contents/Resources/TuiHostSource"
HOST_SOURCE="$(find_repo_source || true)"
HOST_SOURCE="${HOST_SOURCE:-$BUNDLED_SOURCE}"

if [[ ! -d "$HOST_SOURCE" ]]; then
  show_error "Cannot Start $APP_NAME" "Missing TuiHost source at $HOST_SOURCE."
  exit 1
fi

rebuild_host_if_needed "$HOST_SOURCE"

if [[ ! -x "$HOST_BINARY" ]]; then
  show_error "Cannot Start $APP_NAME" "Missing executable host binary at $HOST_BINARY."
  exit 1
fi

if [[ "${TUI_HOST_BOOTSTRAP_ONLY:-0}" == "1" ]]; then
  exit 0
fi

export TUI_HOST_BUNDLE_PATH="$APP"

exec "$HOST_BINARY" "$@"
