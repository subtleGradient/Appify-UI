#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/Scripts/appify-host-lib.sh"

usage() {
  cat >&2 <<'USAGE'
Usage: Scripts/eject-app.sh <Root.app> --output <Standalone.app> [--sign -|IDENTITY|--no-sign]
USAGE
  exit 2
}

[[ $# -ge 1 ]] || usage

SOURCE_APP_INPUT="$1"
shift

OUTPUT=""
SIGN_IDENTITY="-"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      [[ $# -ge 2 ]] || usage
      OUTPUT="$2"
      shift 2
      ;;
    --sign)
      [[ $# -ge 2 ]] || usage
      SIGN_IDENTITY="$2"
      shift 2
      ;;
    --no-sign)
      SIGN_IDENTITY=""
      shift
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n "$OUTPUT" ]] || usage
[[ -d "$SOURCE_APP_INPUT" ]] || appify_fail "Missing source app: $SOURCE_APP_INPUT"

SOURCE_APP="$(cd "$SOURCE_APP_INPUT" && pwd)"
OUTPUT_PARENT="$(dirname "$OUTPUT")"
OUTPUT_BASENAME="$(basename "$OUTPUT")"
mkdir -p "$OUTPUT_PARENT"
OUTPUT_PARENT="$(cd "$OUTPUT_PARENT" && pwd)"
OUTPUT="$OUTPUT_PARENT/$OUTPUT_BASENAME"

if [[ "$SOURCE_APP" == "$OUTPUT" ]]; then
  appify_fail "Output app must be different from source app."
fi

problem="$(appify_host_artifact_problem "$ROOT" || true)"
if [[ -n "$problem" ]]; then
  appify_fail "Cannot eject with stale host artifact: $problem. Run Scripts/build-host-artifact.sh first."
fi

STAGING_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/appify-eject.XXXXXX")"
cleanup() {
  rm -rf "$STAGING_ROOT"
}
trap cleanup EXIT

STAGED_APP="$STAGING_ROOT/$OUTPUT_BASENAME"
rsync -a --delete \
  --exclude "/Contents/Developer/dist" \
  "$SOURCE_APP/" "$STAGED_APP/"

rm -rf \
  "$STAGED_APP/Contents/Developer" \
  "$STAGED_APP/Contents/Resources/AppifyHostSource" \
  "$STAGED_APP/Contents/MacOS/main.sh" \
  "$STAGED_APP/Contents/MacOS/.appify-host-binary-source-hash" \
  "$STAGED_APP/.gitignore"

mkdir -p "$STAGED_APP/Contents/MacOS"
cp "$ROOT/bin/appify-host" "$STAGED_APP/Contents/MacOS/appify-host"
chmod +x "$STAGED_APP/Contents/MacOS/appify-host"

/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable appify-host" "$STAGED_APP/Contents/Info.plist"
plutil -lint "$STAGED_APP/Contents/Info.plist" >/dev/null

if [[ -n "$SIGN_IDENTITY" ]]; then
  if ! command -v codesign >/dev/null 2>&1; then
    appify_fail "codesign is required for signing. Re-run with --no-sign to skip signing."
  fi
  codesign --force --deep --sign "$SIGN_IDENTITY" "$STAGED_APP"
fi

rm -rf "$OUTPUT"
mv "$STAGED_APP" "$OUTPUT"
echo "$OUTPUT"
