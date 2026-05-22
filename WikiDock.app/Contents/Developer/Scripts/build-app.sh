#!/usr/bin/env bash
set -euo pipefail

APP_NAME="WikiDock"
EXECUTABLE_NAME="appify-host"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEVELOPER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_CONTENTS="$(cd "$DEVELOPER_ROOT/.." && pwd)"
SOURCE_APP="$(cd "$SOURCE_CONTENTS/.." && pwd)"

find_repo_root() {
  local dir="$SOURCE_APP"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/source/AppifyHost/Package.swift" ]]; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  echo "Could not find repo root containing source/AppifyHost" >&2
  return 1
}

REPO_ROOT="$(find_repo_root)"
APPIFY_HOST_ROOT="$REPO_ROOT/source/AppifyHost"
APP_SERVER_SOURCE="$SOURCE_APP/Contents/Resources/AppServer"
TEMPLATES_SOURCE="$SOURCE_APP/Contents/Resources/Templates"
DEVELOPER_SOURCE="$SOURCE_APP/Contents/Developer"

APP="${WIKIDOCK_APP_OUTPUT:-$DEVELOPER_ROOT/dist/$APP_NAME.app}"
SIGN_ADHOC="${WIKIDOCK_APP_SIGN:-1}"

source_hash() {
  local source_dir="$1"
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

if [[ ! -f "$APPIFY_HOST_ROOT/Package.swift" ]]; then
  echo "Missing AppifyHost source at $APPIFY_HOST_ROOT" >&2
  exit 1
fi

if [[ ! -x "$APP_SERVER_SOURCE/main.sh" ]]; then
  echo "Missing WikiDock app server at $APP_SERVER_SOURCE" >&2
  exit 1
fi

if [[ ! -d "$DEVELOPER_SOURCE/Scripts" ]]; then
  echo "Missing WikiDock developer scripts at $DEVELOPER_SOURCE/Scripts" >&2
  exit 1
fi

STAGING_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/wikidock-build.XXXXXX")"
cleanup() {
  rm -rf "$STAGING_ROOT"
}
trap cleanup EXIT

APP_PAYLOAD="$STAGING_ROOT/AppPayload"
mkdir -p "$APP_PAYLOAD/Contents/Resources" "$APP_PAYLOAD/Contents/Developer"
rsync -a --delete "$APP_SERVER_SOURCE/" "$APP_PAYLOAD/Contents/Resources/AppServer/"
rsync -a --delete "$TEMPLATES_SOURCE/" "$APP_PAYLOAD/Contents/Resources/Templates/"
rsync -a --delete \
  --exclude "dist" \
  "$DEVELOPER_SOURCE/" "$APP_PAYLOAD/Contents/Developer/"
cp "$SOURCE_APP/Contents/Info.plist" "$APP_PAYLOAD/Contents/Info.plist"
cp "$SOURCE_APP/Contents/PkgInfo" "$APP_PAYLOAD/Contents/PkgInfo"

swift build --package-path "$APPIFY_HOST_ROOT" -c release --product "$EXECUTABLE_NAME"
APPIFY_HOST_SOURCE_HASH="$(source_hash "$APPIFY_HOST_ROOT")"

CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
DEVELOPER="$CONTENTS/Developer"
APPIFY_HOST_SOURCE="$RESOURCES/AppifyHostSource"
APP_SERVER="$RESOURCES/AppServer"
TEMPLATES="$RESOURCES/Templates"

rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES" "$DEVELOPER"

cp "$APPIFY_HOST_ROOT/.build/release/$EXECUTABLE_NAME" "$MACOS/$EXECUTABLE_NAME"
chmod +x "$MACOS/$EXECUTABLE_NAME"

cp "$APPIFY_HOST_ROOT/Scripts/main.sh" "$MACOS/main.sh"
chmod +x "$MACOS/main.sh"

mkdir -p "$APPIFY_HOST_SOURCE"
rsync -a --delete --exclude ".build" "$APPIFY_HOST_ROOT/" "$APPIFY_HOST_SOURCE/"
printf '%s\n' "$APPIFY_HOST_SOURCE_HASH" > "$APPIFY_HOST_SOURCE/.appify-host-source-hash"
printf '%s\n' "$APPIFY_HOST_SOURCE_HASH" > "$MACOS/.appify-host-binary-source-hash"

mkdir -p "$APP_SERVER" "$TEMPLATES"
rsync -a --delete "$APP_PAYLOAD/Contents/Resources/AppServer/" "$APP_SERVER/"
rsync -a --delete "$APP_PAYLOAD/Contents/Resources/Templates/" "$TEMPLATES/"
rsync -a --delete "$APP_PAYLOAD/Contents/Developer/" "$DEVELOPER/"
cp "$APP_PAYLOAD/Contents/Info.plist" "$CONTENTS/Info.plist"
cp "$APP_PAYLOAD/Contents/PkgInfo" "$CONTENTS/PkgInfo"

if [[ "$SIGN_ADHOC" != "1" ]]; then
  cat > "$APP/.gitignore" <<GITIGNORE
Contents/Resources/AppifyHostSource/.build/
Contents/Developer/dist/
GITIGNORE
fi

plutil -lint "$CONTENTS/Info.plist"

if [[ "$SIGN_ADHOC" == "1" ]] && command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP"
fi

echo "$APP"
