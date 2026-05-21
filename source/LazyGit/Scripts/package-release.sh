#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/dist/LazyGit.app"
DIST="$ROOT/dist"
RELEASE_DIR="$DIST/release"
VERSION="${1:-0.1.0}"
ZIP="$RELEASE_DIR/LazyGit.app.zip"
NOTARY_ZIP="$RELEASE_DIR/LazyGit-notary-upload.zip"

fail() {
  echo "error: $*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

developer_id_identity="${DEVELOPER_ID_APPLICATION:-}"
notary_profile="${NOTARYTOOL_PROFILE:-}"

need_command codesign
need_command ditto
need_command spctl
need_command xcrun

if [[ -z "$developer_id_identity" ]]; then
  developer_id_identity="$(security find-identity -p codesigning -v 2>/dev/null \
    | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' \
    | head -n 1)"
fi

if [[ -z "$developer_id_identity" ]]; then
  fail "No Developer ID Application signing identity found. Install the Developer ID Application certificate, or set DEVELOPER_ID_APPLICATION."
fi

if ! security find-identity -p codesigning -v | grep -F "\"$developer_id_identity\"" >/dev/null; then
  fail "Developer ID signing identity is not available in the current keychain: $developer_id_identity"
fi

"$ROOT/Scripts/build-app.sh" >/dev/null

codesign \
  --force \
  --timestamp \
  --options runtime \
  --sign "$developer_id_identity" \
  "$APP/Contents/MacOS/tui-host"

codesign \
  --force \
  --timestamp \
  --options runtime \
  --sign "$developer_id_identity" \
  "$APP"

codesign --verify --deep --strict --verbose=2 "$APP"

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
ditto -c -k --keepParent "$APP" "$NOTARY_ZIP"

notary_args=(notarytool submit "$NOTARY_ZIP" --wait)
if [[ -n "$notary_profile" ]]; then
  notary_args+=(--keychain-profile "$notary_profile")
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_TEAM_ID:-}" && -n "${APP_SPECIFIC_PASSWORD:-}" ]]; then
  notary_args+=(--apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APP_SPECIFIC_PASSWORD")
else
  fail "No notarization credentials found. Set NOTARYTOOL_PROFILE, or set APPLE_ID, APPLE_TEAM_ID, and APP_SPECIFIC_PASSWORD."
fi

xcrun "${notary_args[@]}"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute --verbose=4 "$APP"

ditto -c -k --keepParent "$APP" "$ZIP"
rm -f "$NOTARY_ZIP"

echo "$ZIP"
