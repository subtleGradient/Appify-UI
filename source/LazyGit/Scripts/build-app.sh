#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
APPIFY_HOST_ROOT="$REPO_ROOT/source/AppifyHost"
APP_SERVER_ROOT="$ROOT/AppServer"
APP_NAME="LazyGit"
EXECUTABLE_NAME="main.sh"
BUNDLE_IDENTIFIER="com.subtlegradient.LazyGit"
VERSION="0.1.0"

APP="${LAZYGIT_APP_OUTPUT:-$ROOT/dist/$APP_NAME.app}"
SIGN_ADHOC="${LAZYGIT_APP_SIGN:-1}"

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

if [[ ! -x "$APP_SERVER_ROOT/main.sh" ]]; then
  echo "Missing LazyGit app server at $APP_SERVER_ROOT" >&2
  exit 1
fi

swift build --package-path "$APPIFY_HOST_ROOT" -c release --product appify-host
APPIFY_HOST_SOURCE_HASH="$(source_hash "$APPIFY_HOST_ROOT")"

CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
APPIFY_HOST_SOURCE="$RESOURCES/AppifyHostSource"
APP_SERVER="$RESOURCES/AppServer"

rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES"

cp "$APPIFY_HOST_ROOT/.build/release/appify-host" "$MACOS/appify-host"
chmod +x "$MACOS/appify-host"

cp "$APPIFY_HOST_ROOT/Scripts/main.sh" "$MACOS/main.sh"
chmod +x "$MACOS/main.sh"

mkdir -p "$APPIFY_HOST_SOURCE"
rsync -a --delete --exclude ".build" "$APPIFY_HOST_ROOT/" "$APPIFY_HOST_SOURCE/"
printf '%s\n' "$APPIFY_HOST_SOURCE_HASH" > "$APPIFY_HOST_SOURCE/.appify-host-source-hash"
printf '%s\n' "$APPIFY_HOST_SOURCE_HASH" > "$MACOS/.appify-host-binary-source-hash"

mkdir -p "$APP_SERVER"
rsync -a --delete "$APP_SERVER_ROOT/" "$APP_SERVER/"

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
    <string>folderMarker</string>
    <key>ServerInstallDirectory</key>
    <string>Contents/Resources/AppServer</string>
    <key>ServerExecutable</key>
    <string>main.sh</string>
    <key>ServerArguments</key>
    <array/>
    <key>LogName</key>
    <string>LazyGit</string>
    <key>WindowTitlePrefix</key>
    <string>LazyGit</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>LAZYGIT_APP_PACKAGE</key>
      <string>{documentPath}</string>
      <key>LAZYGIT_APP_WORKDIR</key>
      <string>{workingDirectory}</string>
    </dict>
    <key>WebViewDataStore</key>
    <string>nonPersistent</string>
  </dict>

  <key>UTExportedTypeDeclarations</key>
  <array>
    <dict>
      <key>UTTypeIdentifier</key>
      <string>com.subtlegradient.lazygit</string>
      <key>UTTypeDescription</key>
      <string>LazyGit Folder</string>
      <key>UTTypeConformsTo</key>
      <array>
        <string>com.apple.package</string>
        <string>public.directory</string>
      </array>
      <key>UTTypeTagSpecification</key>
      <dict>
        <key>public.filename-extension</key>
        <array>
          <string>lazygit</string>
        </array>
      </dict>
    </dict>
  </array>

  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key>
      <string>LazyGit Folder</string>
      <key>CFBundleTypeRole</key>
      <string>Editor</string>
      <key>LSHandlerRank</key>
      <string>Owner</string>
      <key>LSTypeIsPackage</key>
      <true/>
      <key>LSItemContentTypes</key>
      <array>
        <string>com.subtlegradient.lazygit</string>
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
GITIGNORE
fi

plutil -lint "$CONTENTS/Info.plist"

if [[ "$SIGN_ADHOC" == "1" ]] && command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP"
fi

echo "$APP"
