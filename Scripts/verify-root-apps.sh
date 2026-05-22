#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

fail() {
  printf 'verify-root-apps: %s\n' "$1" >&2
  exit 1
}

cleanup_paths=""
cleanup() {
  local path
  if [[ -z "$cleanup_paths" ]]; then
    return
  fi
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    rm -f "$path"
  done <<EOF
$cleanup_paths
EOF
}
trap cleanup EXIT

make_temp() {
  local path
  path="$(mktemp "${TMPDIR:-/tmp}/verify-root-apps.XXXXXX")"
  cleanup_paths="${cleanup_paths}${path}
"
  printf '%s\n' "$path"
}

assert_file_lists_equal() {
  local expected_file="$1"
  local actual_file="$2"
  local label="$3"

  if ! diff -u "$expected_file" "$actual_file"; then
    fail "$label did not match expected set"
  fi
}

expected_root_apps="$(make_temp)"
actual_root_apps="$(make_temp)"
printf 'LazyGit.app\nSQLitePeek.app\nTLCanvas.app\n' > "$expected_root_apps"
(
  cd "$ROOT"
  find . -maxdepth 1 -type d -name '*.app' -print | sed 's#^\./##' | LC_ALL=C sort
) > "$actual_root_apps"
assert_file_lists_equal "$expected_root_apps" "$actual_root_apps" "root apps"

diff -qr \
  -x '.build' \
  -x '.appify-host-source-hash' \
  "$ROOT/source/AppifyHost" \
  "$ROOT/LazyGit.app/Contents/Resources/AppifyHostSource" >/dev/null \
  || fail "LazyGit.app bundled AppifyHostSource does not match source/AppifyHost"

diff -qr \
  -x '.build' \
  -x '.appify-host-source-hash' \
  "$ROOT/source/AppifyHost" \
  "$ROOT/TLCanvas.app/Contents/Resources/AppifyHostSource" >/dev/null \
  || fail "TLCanvas.app bundled AppifyHostSource does not match source/AppifyHost"

diff -qr \
  -x '.build' \
  -x '.appify-host-source-hash' \
  "$ROOT/source/AppifyHost" \
  "$ROOT/SQLitePeek.app/Contents/Resources/AppifyHostSource" >/dev/null \
  || fail "SQLitePeek.app bundled AppifyHostSource does not match source/AppifyHost"

[[ -x "$ROOT/LazyGit.app/Contents/Resources/AppServer/main.sh" ]] \
  || fail "LazyGit.app is missing bundled AppServer/main.sh"

[[ -x "$ROOT/TLCanvas.app/Contents/Resources/AppServer/main.sh" ]] \
  || fail "TLCanvas.app is missing bundled AppServer/main.sh"

[[ -x "$ROOT/SQLitePeek.app/Contents/Resources/AppServer/main.sh" ]] \
  || fail "SQLitePeek.app is missing bundled AppServer/main.sh"

for app in LazyGit.app TLCanvas.app SQLitePeek.app; do
  executable="$(plutil -extract CFBundleExecutable raw "$ROOT/$app/Contents/Info.plist")"
  [[ "$executable" == "appify-host" ]] \
    || fail "$app CFBundleExecutable should be appify-host, got $executable"
  [[ -x "$ROOT/$app/Contents/MacOS/appify-host" ]] \
    || fail "$app is missing executable Contents/MacOS/appify-host"
  [[ -x "$ROOT/$app/Contents/MacOS/main.sh" ]] \
    || fail "$app is missing bootstrap Contents/MacOS/main.sh"
done

[[ -f "$ROOT/TLCanvas.app/Contents/Resources/Runner/package.json" ]] \
  || fail "TLCanvas.app is missing bundled Runner/package.json"

[[ -x "$ROOT/LazyGit.app/Contents/Developer/Scripts/build-app.sh" ]] \
  || fail "LazyGit.app is missing developer build script"

[[ -x "$ROOT/TLCanvas.app/Contents/Developer/Scripts/build-app.sh" ]] \
  || fail "TLCanvas.app is missing developer build script"

[[ -x "$ROOT/SQLitePeek.app/Contents/Developer/Scripts/build-app.sh" ]] \
  || fail "SQLitePeek.app is missing developer build script"

APPIFY_HOST_BOOTSTRAP_ONLY=1 "$ROOT/LazyGit.app/Contents/MacOS/main.sh"
APPIFY_HOST_BOOTSTRAP_ONLY=1 "$ROOT/TLCanvas.app/Contents/MacOS/main.sh"
APPIFY_HOST_BOOTSTRAP_ONLY=1 "$ROOT/SQLitePeek.app/Contents/MacOS/main.sh"

echo "root app verification ok"
