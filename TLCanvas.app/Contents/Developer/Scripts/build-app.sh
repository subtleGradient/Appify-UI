#!/usr/bin/env bash
set -euo pipefail

APP_NAME="TLCanvas"
EXECUTABLE_NAME="main.sh"
BUNDLE_IDENTIFIER="com.subtlegradient.tlcanvas"
VERSION="0.1.0"

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
RUNNER_SOURCE="$SOURCE_APP/Contents/Resources/Runner"
DEVELOPER_SOURCE="$SOURCE_APP/Contents/Developer"

APP="${TLCANVAS_APP_OUTPUT:-$DEVELOPER_ROOT/dist/$APP_NAME.app}"
SIGN_ADHOC="${TLCANVAS_APP_SIGN:-1}"

source_hash() {
  local source_dir="$1"
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

if [[ ! -f "$APPIFY_HOST_ROOT/Package.swift" ]]; then
  echo "Missing AppifyHost source at $APPIFY_HOST_ROOT" >&2
  exit 1
fi

if [[ ! -x "$APP_SERVER_SOURCE/main.sh" ]]; then
  echo "Missing TLCanvas app server at $APP_SERVER_SOURCE" >&2
  exit 1
fi

if [[ ! -f "$RUNNER_SOURCE/package.json" ]]; then
  echo "Missing TLCanvas runner source at $RUNNER_SOURCE" >&2
  exit 1
fi

if [[ ! -d "$DEVELOPER_SOURCE/Scripts" ]]; then
  echo "Missing TLCanvas developer scripts at $DEVELOPER_SOURCE/Scripts" >&2
  exit 1
fi

STAGING_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/tlcanvas-build.XXXXXX")"
cleanup() {
  rm -rf "$STAGING_ROOT"
}
trap cleanup EXIT

APP_PAYLOAD="$STAGING_ROOT/AppPayload"
mkdir -p "$APP_PAYLOAD/Contents/Resources" "$APP_PAYLOAD/Contents/Developer"
rsync -a --delete "$APP_SERVER_SOURCE/" "$APP_PAYLOAD/Contents/Resources/AppServer/"
rsync -a --delete \
  --exclude "node_modules" \
  --exclude ".canvas-test" \
  "$RUNNER_SOURCE/" "$APP_PAYLOAD/Contents/Resources/Runner/"
rsync -a --delete \
  --exclude "dist" \
  "$DEVELOPER_SOURCE/" "$APP_PAYLOAD/Contents/Developer/"

swift build --package-path "$APPIFY_HOST_ROOT" -c release --product appify-host
APPIFY_HOST_SOURCE_HASH="$(source_hash "$APPIFY_HOST_ROOT")"

CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
DEVELOPER="$CONTENTS/Developer"
APPIFY_HOST_SOURCE="$RESOURCES/AppifyHostSource"
APP_SERVER="$RESOURCES/AppServer"
RUNNER="$RESOURCES/Runner"

rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES" "$DEVELOPER"

cp "$APPIFY_HOST_ROOT/.build/release/appify-host" "$MACOS/appify-host"
chmod +x "$MACOS/appify-host"

cp "$APPIFY_HOST_ROOT/Scripts/main.sh" "$MACOS/main.sh"
chmod +x "$MACOS/main.sh"

mkdir -p "$APPIFY_HOST_SOURCE"
rsync -a --delete --exclude ".build" "$APPIFY_HOST_ROOT/" "$APPIFY_HOST_SOURCE/"
printf '%s\n' "$APPIFY_HOST_SOURCE_HASH" > "$APPIFY_HOST_SOURCE/.appify-host-source-hash"
printf '%s\n' "$APPIFY_HOST_SOURCE_HASH" > "$MACOS/.appify-host-binary-source-hash"

mkdir -p "$APP_SERVER"
rsync -a --delete "$APP_PAYLOAD/Contents/Resources/AppServer/" "$APP_SERVER/"

mkdir -p "$RUNNER"
rsync -a --delete "$APP_PAYLOAD/Contents/Resources/Runner/" "$RUNNER/"

rsync -a --delete "$APP_PAYLOAD/Contents/Developer/" "$DEVELOPER/"

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundleExecutable</key>
  <string>$EXECUTABLE_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_IDENTIFIER</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleSupportedPlatforms</key>
  <array>
    <string>MacOSX</string>
  </array>
  <key>CFBundleVersion</key>
  <string>$VERSION</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSHumanReadableCopyright</key>
  <string>Copyright © 2026 subtleGradient</string>

  <key>AppifyHost</key>
  <dict>
    <key>DocumentMode</key>
    <string>contentPackage</string>
    <key>ServerInstallDirectory</key>
    <string>Contents/Resources/AppServer</string>
    <key>ServerExecutable</key>
    <string>main.sh</string>
    <key>ServerArguments</key>
    <array/>
    <key>DocumentKindEnvironmentValue</key>
    <string>com.subtlegradient.tlcanvas</string>
    <key>LogName</key>
    <string>TLCanvas</string>
    <key>WindowTitlePrefix</key>
    <string>TLCanvas</string>
    <key>WebViewDataStore</key>
    <string>persistent</string>
    <key>AboutNotice</key>
    <dict>
      <key>Message</key>
      <string>TLCanvas is a local macOS document app built with the tldraw SDK.

It is not affiliated with or endorsed by tldraw Inc. The tldraw SDK and trademarks belong to tldraw Inc.

This developer bundle is intended for local development use. Production distribution requires the appropriate tldraw license or written permission.</string>
      <key>LinkTitle</key>
      <string>Open tldraw.dev</string>
      <key>LinkURL</key>
      <string>https://tldraw.dev</string>
    </dict>
  </dict>

  <key>UTExportedTypeDeclarations</key>
  <array>
    <dict>
      <key>UTTypeIdentifier</key>
      <string>com.subtlegradient.tlcanvas</string>
      <key>UTTypeDescription</key>
      <string>TLCanvas Document</string>
      <key>UTTypeConformsTo</key>
      <array>
        <string>com.apple.package</string>
        <string>public.directory</string>
      </array>
      <key>UTTypeTagSpecification</key>
      <dict>
        <key>public.filename-extension</key>
        <array>
          <string>tlcanvas</string>
        </array>
      </dict>
    </dict>
  </array>

  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key>
      <string>TLCanvas Document</string>
      <key>CFBundleTypeRole</key>
      <string>Editor</string>
      <key>CFBundleTypeExtensions</key>
      <array>
        <string>tlcanvas</string>
      </array>
      <key>LSHandlerRank</key>
      <string>Owner</string>
      <key>LSTypeIsPackage</key>
      <true/>
      <key>LSItemContentTypes</key>
      <array>
        <string>com.subtlegradient.tlcanvas</string>
      </array>
      <key>NSDocumentClass</key>
      <string>AppifyHostDocument</string>
    </dict>
  </array>
</dict>
</plist>
PLIST

cat > "$CONTENTS/PkgInfo" <<PKGINFO
APPL????
PKGINFO

if [[ "$SIGN_ADHOC" != "1" ]]; then
  cat > "$APP/.gitignore" <<GITIGNORE
Contents/Resources/AppifyHostSource/.build/
Contents/Resources/Runner/node_modules/
Contents/Resources/Runner/.canvas-test/
Contents/Developer/dist/
GITIGNORE
fi

plutil -lint "$CONTENTS/Info.plist"

if [[ "$SIGN_ADHOC" == "1" ]] && command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP"
fi

echo "$APP"
