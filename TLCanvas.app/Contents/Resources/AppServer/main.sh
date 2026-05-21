#!/usr/bin/env bash
set -euo pipefail

APP="${APPIFY_HOST_BUNDLE_PATH:?APPIFY_HOST_BUNDLE_PATH is required}"
RUNNER_DIR="${TLCANVAS_RUNNER_DIR:-$APP/Contents/Resources/Runner}"
DOCUMENT_PATH="${APPIFY_HOST_DOCUMENT_PATH:?APPIFY_HOST_DOCUMENT_PATH is required}"

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
  local wrapper_dir="$cache_root/Appify-UI/TLCanvas"
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
  if [[ -n "${APPIFY_HOST_BUN:-}" ]]; then
    candidates+=("$APPIFY_HOST_BUN")
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

if ! BUN_PATH="$(resolve_bun)"; then
  printf 'TLCanvas requires Bun. Install it from https://bun.sh, install Nix, or set APPIFY_HOST_BUN.\n' >&2
  exit 1
fi

install_runner_dependencies_if_needed "$RUNNER_DIR" "$BUN_PATH"
cd "$RUNNER_DIR"
exec "$BUN_PATH" src/index.ts "$DOCUMENT_PATH" "$@"
