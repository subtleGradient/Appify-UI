#!/usr/bin/env bash

appify_fail() {
  printf 'appify-host: %s\n' "$*" >&2
  exit 1
}

appify_show_error() {
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

appify_app_name() {
  local app="$1"
  local info_plist="$app/Contents/Info.plist"
  local display_name bundle_name
  display_name="$(/usr/libexec/PlistBuddy -c "Print :CFBundleDisplayName" "$info_plist" 2>/dev/null || true)"
  bundle_name="$(/usr/libexec/PlistBuddy -c "Print :CFBundleName" "$info_plist" 2>/dev/null || true)"
  if [[ -n "$display_name" ]]; then
    printf '%s\n' "$display_name"
  elif [[ -n "$bundle_name" ]]; then
    printf '%s\n' "$bundle_name"
  else
    basename "$app" .app
  fi
}

appify_source_hash() {
  local source_dir="$1"

  if ! command -v shasum >/dev/null 2>&1; then
    appify_fail "Missing shasum, which is required to hash AppifyHost source."
  fi

  (
    cd "$source_dir"
    find . -path "./.build" -prune -o -type f \( -name "Package.swift" -o -name "*.swift" \) -print \
      | LC_ALL=C sort \
      | while IFS= read -r source_file; do
          printf '%s\n' "$source_file"
          shasum -a 256 "$source_file" | awk '{print $1}'
        done
  ) | shasum -a 256 | awk '{print $1}'
}

appify_file_hash() {
  shasum -a 256 "$1" | awk '{print $1}'
}

appify_manifest_value() {
  local manifest="$1"
  local key="$2"
  /usr/bin/plutil -extract "$key" raw "$manifest" 2>/dev/null || true
}

appify_host_artifact_problem() {
  local root="$1"
  local source_dir="$root/source/AppifyHost"
  local host_binary="$root/bin/appify-host"
  local manifest="$root/bin/appify-host.manifest.json"
  local current_source_hash manifest_source_hash manifest_binary_hash actual_binary_hash

  if [[ ! -f "$source_dir/Package.swift" ]]; then
    printf 'missing canonical source/AppifyHost/Package.swift\n'
    return 1
  fi

  if [[ ! -x "$host_binary" ]]; then
    printf 'missing executable bin/appify-host\n'
    return 1
  fi

  if [[ ! -f "$manifest" ]]; then
    printf 'missing bin/appify-host.manifest.json\n'
    return 1
  fi

  current_source_hash="$(appify_source_hash "$source_dir")"
  manifest_source_hash="$(appify_manifest_value "$manifest" sourceHash)"
  if [[ "$manifest_source_hash" != "$current_source_hash" ]]; then
    printf 'manifest sourceHash %s does not match source/AppifyHost hash %s\n' "$manifest_source_hash" "$current_source_hash"
    return 1
  fi

  manifest_binary_hash="$(appify_manifest_value "$manifest" binaryHash)"
  actual_binary_hash="$(appify_file_hash "$host_binary")"
  if [[ "$manifest_binary_hash" != "$actual_binary_hash" ]]; then
    printf 'manifest binaryHash %s does not match bin/appify-host hash %s\n' "$manifest_binary_hash" "$actual_binary_hash"
    return 1
  fi

  return 0
}
