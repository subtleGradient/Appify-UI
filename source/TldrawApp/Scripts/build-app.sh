#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
WEBAPP_HOST_ROOT="$REPO_ROOT/source/WebappHost"
RUNNER_ROOT="$ROOT/Runner"
APP_NAME="tldraw"
EXECUTABLE_NAME="main.sh"
BUNDLE_IDENTIFIER="com.subtlegradient.tldraw"
VERSION="0.1.0"

APP="${TLDRAW_APP_OUTPUT:-$ROOT/dist/$APP_NAME.app}"
SIGN_ADHOC="${TLDRAW_APP_SIGN:-1}"

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

if [[ ! -f "$WEBAPP_HOST_ROOT/Package.swift" ]]; then
  echo "Missing WebappHost source at $WEBAPP_HOST_ROOT" >&2
  exit 1
fi

if [[ ! -f "$RUNNER_ROOT/package.json" ]]; then
  echo "Missing tldraw runner source at $RUNNER_ROOT" >&2
  exit 1
fi

swift build --package-path "$WEBAPP_HOST_ROOT" -c release --product webapp-host
WEBAPP_HOST_SOURCE_HASH="$(source_hash "$WEBAPP_HOST_ROOT")"

CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
WEBAPP_HOST_SOURCE="$RESOURCES/WebappHostSource"
RUNNER="$RESOURCES/Runner"

rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES"

cp "$WEBAPP_HOST_ROOT/.build/release/webapp-host" "$MACOS/webapp-host"
chmod +x "$MACOS/webapp-host"

cp "$WEBAPP_HOST_ROOT/Scripts/main.sh" "$MACOS/main.sh"
chmod +x "$MACOS/main.sh"

mkdir -p "$WEBAPP_HOST_SOURCE"
rsync -a --delete --exclude ".build" "$WEBAPP_HOST_ROOT/" "$WEBAPP_HOST_SOURCE/"
printf '%s\n' "$WEBAPP_HOST_SOURCE_HASH" > "$WEBAPP_HOST_SOURCE/.webapp-host-source-hash"
printf '%s\n' "$WEBAPP_HOST_SOURCE_HASH" > "$MACOS/.webapp-host-binary-source-hash"

mkdir -p "$RUNNER"
rsync -a --delete \
  --exclude "node_modules" \
  --exclude ".canvas-test" \
  "$RUNNER_ROOT/" "$RUNNER/"

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

  <key>WebappHost</key>
  <dict>
    <key>RunnerInstallDirectory</key>
    <string>Contents/Resources/Runner</string>
    <key>RunnerEntry</key>
    <string>src/index.ts</string>
    <key>RunnerArguments</key>
    <array/>
    <key>DocumentKindEnvironmentValue</key>
    <string>com.subtlegradient.tldraw-canvas</string>
    <key>LogName</key>
    <string>tldraw</string>
  </dict>

  <key>UTExportedTypeDeclarations</key>
  <array>
    <dict>
      <key>UTTypeIdentifier</key>
      <string>com.subtlegradient.tldraw-canvas</string>
      <key>UTTypeDescription</key>
      <string>tldraw Canvas</string>
      <key>UTTypeConformsTo</key>
      <array>
        <string>com.apple.package</string>
        <string>public.directory</string>
      </array>
      <key>UTTypeTagSpecification</key>
      <dict>
        <key>public.filename-extension</key>
        <array>
          <string>tldraw</string>
        </array>
      </dict>
    </dict>
  </array>

  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key>
      <string>tldraw Canvas</string>
      <key>CFBundleTypeRole</key>
      <string>Editor</string>
      <key>CFBundleTypeExtensions</key>
      <array>
        <string>tldraw</string>
      </array>
      <key>LSHandlerRank</key>
      <string>Owner</string>
      <key>LSTypeIsPackage</key>
      <true/>
      <key>LSItemContentTypes</key>
      <array>
        <string>com.subtlegradient.tldraw-canvas</string>
      </array>
      <key>NSDocumentClass</key>
      <string>WebappHostDocument</string>
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
Contents/Resources/WebappHostSource/.build/
Contents/Resources/Runner/node_modules/
Contents/Resources/Runner/.canvas-test/
GITIGNORE
fi

plutil -lint "$CONTENTS/Info.plist"

if [[ "$SIGN_ADHOC" == "1" ]] && command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP"
fi

echo "$APP"
