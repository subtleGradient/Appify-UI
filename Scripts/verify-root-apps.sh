#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/Scripts/appify-host-lib.sh"

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
    rm -rf "$path"
  done <<EOF
$cleanup_paths
EOF
}
trap cleanup EXIT

make_temp_file() {
  local path
  path="$(mktemp "${TMPDIR:-/tmp}/verify-root-apps.XXXXXX")"
  cleanup_paths="${cleanup_paths}${path}
"
  printf '%s\n' "$path"
}

make_temp_dir() {
  local path
  path="$(mktemp -d "${TMPDIR:-/tmp}/verify-root-apps.XXXXXX")"
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

root_apps=(
  JSONCanvas.app
  LazyGit.app
  LogScope.app
  TLCanvas.app
  Web.app
  Webapp.app
  WebFormer.app
  WikiDock.app
  litecli.app
  tw.app
)
thin_apps=("${root_apps[@]}" "examples/hello-world.appdev/Hello.app")

expected_root_apps="$(make_temp_file)"
actual_root_apps="$(make_temp_file)"
printf '%s\n' "${root_apps[@]}" | LC_ALL=C sort > "$expected_root_apps"
(
  cd "$ROOT"
  git ls-files '*.app/Contents/Info.plist' | awk -F/ 'NF == 3 { print $1 }' | LC_ALL=C sort
) > "$actual_root_apps"
assert_file_lists_equal "$expected_root_apps" "$actual_root_apps" "checked-in root apps"

expected_shim="$(make_temp_file)"
cat > "$expected_shim" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail

APP="$(cd "$(dirname "$0")/../.." && pwd)"
cursor="$APP"
while [[ "$cursor" != "/" ]]; do
  launcher="$cursor/Scripts/appify-host-launcher.sh"
  if [[ -x "$launcher" ]]; then
    exec "$launcher" "$APP" "$@"
  fi
  cursor="$(dirname "$cursor")"
done

printf 'Cannot find Appify UI repo launcher for %s. Use Scripts/eject-app.sh to create a standalone app.\n' "$APP" >&2
exit 1
SHIM

tracked_stale="$(git -C "$ROOT" ls-files '*Contents/Resources/AppifyHostSource*' '*Contents/MacOS/appify-host' '*appify-host-binary-source-hash')"
if [[ -n "$tracked_stale" ]]; then
  printf '%s\n' "$tracked_stale" >&2
  fail "tracked stale AppifyHost copies are not allowed"
fi

problem="$(appify_host_artifact_problem "$ROOT" || true)"
if [[ -n "$problem" ]]; then
  fail "bin/appify-host is not current: $problem"
fi

for app in "${thin_apps[@]}"; do
  app_path="$ROOT/$app"
  [[ -d "$app_path" ]] || fail "$app is missing"

  executable="$(plutil -extract CFBundleExecutable raw "$app_path/Contents/Info.plist")"
  [[ "$executable" == "main.sh" ]] \
    || fail "$app CFBundleExecutable should be main.sh, got $executable"
  [[ -x "$app_path/Contents/MacOS/main.sh" ]] \
    || fail "$app is missing executable Contents/MacOS/main.sh"
  cmp -s "$expected_shim" "$app_path/Contents/MacOS/main.sh" \
    || fail "$app Contents/MacOS/main.sh is not the canonical thin shim"
  [[ ! -e "$app_path/Contents/MacOS/appify-host" ]] \
    || fail "$app must not contain Contents/MacOS/appify-host"
  [[ ! -e "$app_path/Contents/MacOS/.appify-host-binary-source-hash" ]] \
    || fail "$app must not contain an AppifyHost binary hash sidecar"
  [[ ! -e "$app_path/Contents/Resources/AppifyHostSource" ]] \
    || fail "$app must not contain Contents/Resources/AppifyHostSource"
  [[ -x "$app_path/Contents/Resources/AppServer/main.sh" ]] \
    || fail "$app is missing bundled AppServer/main.sh"
done

[[ -f "$ROOT/litecli.app/Contents/Resources/AppServer/liteclirc" ]] \
  || fail "litecli.app is missing bundled AppServer/liteclirc"

[[ -f "$ROOT/TLCanvas.app/Contents/Resources/Runner/package.json" ]] \
  || fail "TLCanvas.app is missing bundled Runner/package.json"

[[ -f "$ROOT/JSONCanvas.app/Contents/Resources/Runner/package.json" ]] \
  || fail "JSONCanvas.app is missing bundled Runner/package.json"

[[ -f "$ROOT/Web.app/Contents/Resources/Runner/package.json" ]] \
  || fail "Web.app is missing bundled Runner/package.json"

[[ -f "$ROOT/Webapp.app/Contents/Resources/Runner/package.json" ]] \
  || fail "Webapp.app is missing bundled Runner/package.json"

[[ -f "$ROOT/WebFormer.app/Contents/Resources/Runner/package.json" ]] \
  || fail "WebFormer.app is missing bundled Runner/package.json"

for app in "${root_apps[@]}"; do
  [[ -x "$ROOT/$app/Contents/Developer/Scripts/build-app.sh" ]] \
    || fail "$app is missing developer build script"
  [[ -x "$ROOT/$app/Contents/Developer/Scripts/build-root-app.sh" ]] \
    || fail "$app is missing developer root verification script"
done

for app in "${thin_apps[@]}"; do
  APPIFY_HOST_BOOTSTRAP_ONLY=1 "$ROOT/$app/Contents/MacOS/main.sh"
done

eject_root="$(make_temp_dir)"
ejected_app="$eject_root/WebFormer.app"
"$ROOT/Scripts/eject-app.sh" "$ROOT/WebFormer.app" --output "$ejected_app" --sign - >/dev/null

ejected_executable="$(plutil -extract CFBundleExecutable raw "$ejected_app/Contents/Info.plist")"
[[ "$ejected_executable" == "appify-host" ]] \
  || fail "ejected WebFormer CFBundleExecutable should be appify-host, got $ejected_executable"
[[ -x "$ejected_app/Contents/MacOS/appify-host" ]] \
  || fail "ejected WebFormer is missing Contents/MacOS/appify-host"
[[ ! -e "$ejected_app/Contents/MacOS/main.sh" ]] \
  || fail "ejected WebFormer should not contain the repo launcher shim"
[[ ! -d "$ejected_app/Contents/Developer" ]] \
  || fail "ejected WebFormer should not contain Contents/Developer"
if find "$ejected_app" -path '*AppifyHostSource*' -print | grep -q .; then
  fail "ejected WebFormer should not contain AppifyHostSource"
fi

echo "root app verification ok"
