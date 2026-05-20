#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="LazyGit"
EXECUTABLE_NAME="LazyGit"
BUNDLE_IDENTIFIER="com.subtlegradient.LazyGit"
VERSION="0.1.0"

cd "$ROOT"

swift build -c release --product LazyGit

DIST="$ROOT/dist"
APP="$DIST/$APP_NAME.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"

rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES"

cp "$ROOT/.build/release/LazyGit" "$MACOS/$EXECUTABLE_NAME"
chmod +x "$MACOS/$EXECUTABLE_NAME"

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
    </dict>
  </array>
</dict>
</plist>
PLIST

cat > "$CONTENTS/PkgInfo" <<PKGINFO
APPL????
PKGINFO

plutil -lint "$CONTENTS/Info.plist"

if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP"
fi

echo "$APP"
