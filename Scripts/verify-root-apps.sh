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
  Scripts.app
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

tracked_legacy="$(git -C "$ROOT" ls-files 'bin/appify-host' 'bin/appify-host.manifest.json')"
if [[ -n "$tracked_legacy" ]]; then
  printf '%s\n' "$tracked_legacy" >&2
  fail "tracked unqualified AppifyHost artifacts are not allowed"
fi

for legacy_path in "$ROOT/bin/appify-host" "$ROOT/bin/appify-host.manifest.json"; do
  [[ ! -e "$legacy_path" ]] || fail "unqualified AppifyHost artifact must not exist: ${legacy_path#$ROOT/}"
done

host_architectures=(arm64 x86_64)
for architecture in "${host_architectures[@]}"; do
  host_binary_relative="$(appify_host_binary_relative_path "$architecture")"
  problem="$(appify_host_artifact_problem "$ROOT" "$architecture" || true)"
  if [[ -n "$problem" ]]; then
    fail "$host_binary_relative is not current: $problem"
  fi
done

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

for app in "${root_apps[@]}"; do
  app_path="$ROOT/$app"
  source_dir="$(appify_app_source_directory "$app_path")"
  [[ -f "$app_path/$source_dir/README.md" ]] \
    || fail "$app is missing app source README at $source_dir/README.md"
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

[[ -f "$ROOT/Scripts.app/Contents/Resources/Runner/package.json" ]] \
  || fail "Scripts.app is missing bundled Runner/package.json"
codesign -vvv --strict "$ROOT/Scripts.app" >/dev/null 2>&1 \
  || fail "Scripts.app root bundle signature is invalid; run codesign --force --deep --sign - Scripts.app after editing it"

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
ejected_source_commit="$(plutil -extract AppifyHost.SourceReference.Commit raw "$ejected_app/Contents/Info.plist")"
[[ -n "$ejected_source_commit" ]] \
  || fail "ejected WebFormer should include AppifyHost SourceReference Commit"
ejected_source_app_path="$(plutil -extract AppifyHost.SourceReference.AppPath raw "$ejected_app/Contents/Info.plist")"
[[ "$ejected_source_app_path" == "WebFormer.app" ]] \
  || fail "ejected WebFormer SourceReference AppPath should be WebFormer.app, got $ejected_source_app_path"
ejected_source_dir="$(plutil -extract AppifyHost.SourceReference.SourceDirectory raw "$ejected_app/Contents/Info.plist")"
[[ "$ejected_source_dir" == "Contents/Resources/Runner" ]] \
  || fail "ejected WebFormer SourceReference SourceDirectory should be Contents/Resources/Runner, got $ejected_source_dir"

echo "root app verification ok"
