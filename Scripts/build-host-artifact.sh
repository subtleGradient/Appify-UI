#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/Scripts/appify-host-lib.sh"

usage() {
  cat >&2 <<'USAGE'
Usage: Scripts/build-host-artifact.sh [--arch arm64|x86_64] [--skip-tests]
USAGE
  exit 2
}

ARCHITECTURE=""
RUN_TESTS=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      [[ $# -ge 2 ]] || usage
      ARCHITECTURE="$2"
      shift 2
      ;;
    --skip-tests)
      RUN_TESTS=0
      shift
      ;;
    *)
      usage
      ;;
  esac
done

ARCHITECTURE="$(appify_host_arch "$ARCHITECTURE")"
SOURCE_DIR="$ROOT/source/AppifyHost"
HOST_DIR="$ROOT/bin"
HOST_BINARY_RELATIVE="$(appify_host_binary_relative_path "$ARCHITECTURE")"
MANIFEST_RELATIVE="$(appify_host_manifest_relative_path "$ARCHITECTURE")"
HOST_BINARY="$ROOT/$HOST_BINARY_RELATIVE"
MANIFEST="$ROOT/$MANIFEST_RELATIVE"
BUILT_BINARY="$(appify_host_build_output_path "$SOURCE_DIR" release "$ARCHITECTURE")"

[[ -f "$SOURCE_DIR/Package.swift" ]] || appify_fail "Missing AppifyHost source at $SOURCE_DIR"

if [[ "$RUN_TESTS" == "1" ]]; then
  (cd "$SOURCE_DIR" && swift test --arch "$ARCHITECTURE")
fi
swift build --package-path "$SOURCE_DIR" -c release --product appify-host --arch "$ARCHITECTURE"
[[ -x "$BUILT_BINARY" ]] || appify_fail "Swift build did not produce $BUILT_BINARY"

mkdir -p "$HOST_DIR"
cp "$BUILT_BINARY" "$HOST_BINARY"
chmod +x "$HOST_BINARY"
codesign --force --sign - "$HOST_BINARY"

source_hash="$(appify_source_hash "$SOURCE_DIR")"
binary_hash="$(appify_file_hash "$HOST_BINARY")"
actual_architectures="$(lipo -archs "$HOST_BINARY" 2>/dev/null || true)"
if [[ " $actual_architectures " != *" $ARCHITECTURE "* ]]; then
  appify_fail "$HOST_BINARY_RELATIVE architectures ${actual_architectures:-unknown} do not include $ARCHITECTURE"
fi
manifest_tmp="$(mktemp "${TMPDIR:-/tmp}/appify-host-manifest.XXXXXX.json")"

cat > "$manifest_tmp" <<JSON
{
  "schema": 1,
  "product": "appify-host",
  "configuration": "release",
  "source": "source/AppifyHost",
  "sourceHash": "$source_hash",
  "binary": "$HOST_BINARY_RELATIVE",
  "binaryHash": "$binary_hash",
  "architecture": "$ARCHITECTURE"
}
JSON

plutil -convert json -o /dev/null "$manifest_tmp"
mv "$manifest_tmp" "$MANIFEST"

echo "$HOST_BINARY"
