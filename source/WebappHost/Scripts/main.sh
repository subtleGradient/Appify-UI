#!/usr/bin/env bash
set -euo pipefail

APP="$(cd "$(dirname "$0")/../.." && pwd)"
INFO_PLIST="$APP/Contents/Info.plist"
HOST_BINARY="$APP/Contents/MacOS/webapp-host"
HOST_HASH_FILE="$APP/Contents/MacOS/.webapp-host-binary-source-hash"
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

resolve_nix_shell() {
  local candidates=(
    "/nix/var/nix/profiles/default/bin/nix-shell"
    "$HOME/.nix-profile/bin/nix-shell"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v nix-shell >/dev/null 2>&1; then
    command -v nix-shell
    return 0
  fi

  return 1
}

write_nix_bun_wrapper() {
  local nix_shell="$1"
  local cache_root="${XDG_CACHE_HOME:-$HOME/Library/Caches}"
  local wrapper_dir="$cache_root/Appify-UI/WebappHost"
  local wrapper="$wrapper_dir/bun-via-nix.sh"

  mkdir -p "$wrapper_dir"
  cat > "$wrapper" <<WRAPPER
#!/usr/bin/env bash
set -euo pipefail

nix_shell=$(printf '%q' "$nix_shell")
command="bun"
for arg in "\$@"; do
  command="\$command \$(printf '%q' "\$arg")"
done

exec "\$nix_shell" -p bun --run "\$command"
WRAPPER
  chmod +x "$wrapper"
  printf '%s\n' "$wrapper"
}

resolve_bun() {
  local candidates=()
  if [[ -n "${WEBAPP_HOST_BUN:-}" ]]; then
    candidates+=("$WEBAPP_HOST_BUN")
  fi
  candidates+=(
    "$APP/Contents/MacOS/bun"
    "$HOME/.bun/bin/bun"
    "/opt/homebrew/bin/bun"
    "/usr/local/bin/bun"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi

  local nix_shell
  if nix_shell="$(resolve_nix_shell)"; then
    write_nix_bun_wrapper "$nix_shell"
    return 0
  fi

  return 1
}

find_repo_source() {
  local cursor="$APP"
  while [[ "$cursor" != "/" ]]; do
    if [[ -d "$cursor/source/WebappHost" && -f "$cursor/source/WebappHost/Package.swift" ]]; then
      printf '%s\n' "$cursor/source/WebappHost"
      return 0
    fi
    cursor="$(dirname "$cursor")"
  done
  return 1
}

source_hash() {
  local source_dir="$1"

  if ! command -v shasum >/dev/null 2>&1; then
    show_error "Cannot Check $(app_name)" "Missing shasum, which is required to compare bundled Swift source hashes."
    exit 1
  fi

  (
    cd "$source_dir"
    find . -type f \( -name "Package.swift" -o -name "*.swift" \) -print \
      | LC_ALL=C sort \
      | while IFS= read -r source_file; do
          printf '%s\n' "$source_file"
          shasum -a 256 "$source_file" | awk '{print $1}'
        done
  ) | shasum -a 256 | awk '{print $1}'
}

read_hash_file() {
  local path="$1"
  if [[ -f "$path" ]]; then
    sed -n '1p' "$path"
  fi
}

install_runner_dependencies_if_needed() {
  local runner_dir="$1"
  local bun_path="$2"

  if [[ ! -f "$runner_dir/package.json" ]]; then
    return 0
  fi

  local stale=0
  if [[ ! -d "$runner_dir/node_modules" ]]; then
    stale=1
  elif [[ "$runner_dir/package.json" -nt "$runner_dir/node_modules" ]]; then
    stale=1
  elif [[ -f "$runner_dir/bun.lock" && "$runner_dir/bun.lock" -nt "$runner_dir/node_modules" ]]; then
    stale=1
  fi

  if [[ "$stale" == "1" ]]; then
    (
      cd "$runner_dir"
      "$bun_path" install --frozen-lockfile
    )
  fi
}

rebuild_host_if_needed() {
  local source_dir="$1"
  local current_hash built_hash
  current_hash="$(source_hash "$source_dir")"
  built_hash="$(read_hash_file "$HOST_HASH_FILE")"

  if [[ -x "$HOST_BINARY" && "$built_hash" == "$current_hash" ]]; then
    return 0
  fi

  if ! command -v swift >/dev/null 2>&1; then
    show_error "Cannot Rebuild $(app_name)" "Swift is not installed, and the bundled webapp-host binary is not built from the current Swift source. Install Xcode command line tools or restore a fresh app bundle."
    exit 1
  fi

  swift build --package-path "$source_dir" -c debug --product webapp-host
  local built_binary="$source_dir/.build/debug/webapp-host"
  if [[ ! -x "$built_binary" ]]; then
    show_error "Cannot Rebuild $(app_name)" "Swift build completed without producing $built_binary."
    exit 1
  fi

  cp "$built_binary" "$HOST_BINARY"
  chmod +x "$HOST_BINARY"
  printf '%s\n' "$current_hash" > "$HOST_HASH_FILE"
}

APP_NAME="$(app_name)"
RUNNER_INSTALL_DIRECTORY="$(read_plist "WebappHost:RunnerInstallDirectory")"
RUNNER_INSTALL_DIRECTORY="${RUNNER_INSTALL_DIRECTORY:-Contents/Resources/Runner}"
if [[ "$RUNNER_INSTALL_DIRECTORY" == /* ]]; then
  RUNNER_DIR="$RUNNER_INSTALL_DIRECTORY"
else
  RUNNER_DIR="$APP/$RUNNER_INSTALL_DIRECTORY"
fi
BUNDLED_SOURCE="$APP/Contents/Resources/WebappHostSource"
HOST_SOURCE="$(find_repo_source || true)"
HOST_SOURCE="${HOST_SOURCE:-$BUNDLED_SOURCE}"

if [[ ! -d "$HOST_SOURCE" ]]; then
  show_error "Cannot Start $APP_NAME" "Missing WebappHost source at $HOST_SOURCE."
  exit 1
fi

if ! BUN_PATH="$(resolve_bun)"; then
  show_error "Cannot Start $APP_NAME" "Bun is required. Install it from https://bun.sh, install Nix, or set WEBAPP_HOST_BUN to an executable Bun path."
  exit 1
fi

install_runner_dependencies_if_needed "$RUNNER_DIR" "$BUN_PATH"
rebuild_host_if_needed "$HOST_SOURCE"

if [[ ! -x "$HOST_BINARY" ]]; then
  show_error "Cannot Start $APP_NAME" "Missing executable host binary at $HOST_BINARY."
  exit 1
fi

if [[ "${WEBAPP_HOST_BOOTSTRAP_ONLY:-0}" == "1" ]]; then
  exit 0
fi

export WEBAPP_HOST_BUNDLE_PATH="$APP"
export WEBAPP_HOST_BUN="$BUN_PATH"

exec "$HOST_BINARY" "$@"
