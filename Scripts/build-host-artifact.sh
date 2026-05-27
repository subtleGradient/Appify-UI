#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/Scripts/appify-host-lib.sh"

SOURCE_DIR="$ROOT/source/AppifyHost"
HOST_DIR="$ROOT/bin"
HOST_BINARY="$HOST_DIR/appify-host"
MANIFEST="$HOST_DIR/appify-host.manifest.json"

[[ -f "$SOURCE_DIR/Package.swift" ]] || appify_fail "Missing AppifyHost source at $SOURCE_DIR"

(cd "$SOURCE_DIR" && swift test)
swift build --package-path "$SOURCE_DIR" -c release --product appify-host

mkdir -p "$HOST_DIR"
cp "$SOURCE_DIR/.build/release/appify-host" "$HOST_BINARY"
chmod +x "$HOST_BINARY"
codesign --force --sign - "$HOST_BINARY"

source_hash="$(appify_source_hash "$SOURCE_DIR")"
binary_hash="$(appify_file_hash "$HOST_BINARY")"
architecture="$(lipo -archs "$HOST_BINARY" 2>/dev/null || uname -m)"
manifest_tmp="$(mktemp "${TMPDIR:-/tmp}/appify-host-manifest.XXXXXX.json")"

cat > "$manifest_tmp" <<JSON
{
  "schema": 1,
  "product": "appify-host",
  "configuration": "release",
  "source": "source/AppifyHost",
  "sourceHash": "$source_hash",
  "binary": "bin/appify-host",
  "binaryHash": "$binary_hash",
  "architecture": "$architecture"
}
JSON

plutil -convert json -o /dev/null "$manifest_tmp"
mv "$manifest_tmp" "$MANIFEST"

echo "$HOST_BINARY"
