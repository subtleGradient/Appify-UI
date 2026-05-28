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

appify_host_arch() {
  local architecture="${1:-}"
  if [[ -z "$architecture" ]]; then
    architecture="${APPIFY_HOST_ARCH:-$(uname -m)}"
  fi

  case "$architecture" in
    arm64|arm64e)
      printf 'arm64\n'
      ;;
    x86_64|amd64|i386)
      printf 'x86_64\n'
      ;;
    *)
      printf '%s\n' "$architecture"
      ;;
  esac
}

appify_host_binary_relative_path() {
  local architecture
  architecture="$(appify_host_arch "${1:-}")"
  printf 'bin/appify-host-%s\n' "$architecture"
}

appify_host_manifest_relative_path() {
  local architecture
  architecture="$(appify_host_arch "${1:-}")"
  printf 'bin/appify-host-%s.manifest.json\n' "$architecture"
}

appify_host_binary_path() {
  local root="$1"
  local architecture="${2:-}"
  printf '%s/%s\n' "$root" "$(appify_host_binary_relative_path "$architecture")"
}

appify_host_manifest_path() {
  local root="$1"
  local architecture="${2:-}"
  printf '%s/%s\n' "$root" "$(appify_host_manifest_relative_path "$architecture")"
}

appify_host_build_output_path() {
  local source_dir="$1"
  local configuration="$2"
  local architecture
  architecture="$(appify_host_arch "${3:-}")"
  printf '%s/.build/%s-apple-macosx/%s/appify-host\n' "$source_dir" "$architecture" "$configuration"
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

appify_app_source_directory() {
  local app="$1"
  if [[ -d "$app/Contents/Resources/Runner" ]]; then
    printf 'Contents/Resources/Runner\n'
  else
    printf 'Contents/Resources/AppServer\n'
  fi
}

appify_manifest_value() {
  local manifest="$1"
  local key="$2"
  /usr/bin/plutil -extract "$key" raw "$manifest" 2>/dev/null || true
}

appify_host_artifact_problem() {
  local root="$1"
  local architecture
  architecture="$(appify_host_arch "${2:-}")"
  local source_dir="$root/source/AppifyHost"
  local host_binary_relative manifest_relative host_binary manifest
  host_binary_relative="$(appify_host_binary_relative_path "$architecture")"
  manifest_relative="$(appify_host_manifest_relative_path "$architecture")"
  host_binary="$root/$host_binary_relative"
  manifest="$root/$manifest_relative"
  local current_source_hash manifest_source_hash manifest_binary manifest_architecture manifest_binary_hash actual_binary_hash actual_architectures

  if [[ ! -f "$source_dir/Package.swift" ]]; then
    printf 'missing canonical source/AppifyHost/Package.swift\n'
    return 1
  fi

  if [[ ! -x "$host_binary" ]]; then
    printf 'missing executable %s\n' "$host_binary_relative"
    return 1
  fi

  if [[ ! -f "$manifest" ]]; then
    printf 'missing %s\n' "$manifest_relative"
    return 1
  fi

  manifest_binary="$(appify_manifest_value "$manifest" binary)"
  if [[ "$manifest_binary" != "$host_binary_relative" ]]; then
    printf 'manifest binary %s does not match expected %s\n' "$manifest_binary" "$host_binary_relative"
    return 1
  fi

  manifest_architecture="$(appify_manifest_value "$manifest" architecture)"
  if [[ "$manifest_architecture" != "$architecture" ]]; then
    printf 'manifest architecture %s does not match current architecture %s\n' "$manifest_architecture" "$architecture"
    return 1
  fi

  actual_architectures="$(lipo -archs "$host_binary" 2>/dev/null || true)"
  if [[ " $actual_architectures " != *" $architecture "* ]]; then
    printf '%s architectures %s do not include %s\n' "$host_binary_relative" "${actual_architectures:-unknown}" "$architecture"
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
    printf 'manifest binaryHash %s does not match %s hash %s\n' "$manifest_binary_hash" "$host_binary_relative" "$actual_binary_hash"
    return 1
  fi

  return 0
}
