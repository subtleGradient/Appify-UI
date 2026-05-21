#!/usr/bin/env bash
set -euo pipefail

APPLE_ID="eng.aop@gmail.com"
TEAM_ID="343ZZ763EA"
NOTARY_PROFILE="subtlegradient-notary"
DEVELOPER_ID_APPLICATION="${DEVELOPER_ID_APPLICATION:-Developer ID Application: Thomas Aylott (${TEAM_ID})}"
VERSION="${1:-0.1.0}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

finish() {
  local status=$?
  trap - EXIT
  echo
  if [[ "$status" -eq 0 ]]; then
    echo "LazyGit release package is ready:"
    echo "  $ROOT/dist/release/LazyGit.app.zip"
  else
    echo "LazyGit signing/notarization failed with exit code $status."
  fi
  echo
  echo "Press Return to close this window."
  read -r _
  exit "$status"
}
trap finish EXIT

fail() {
  echo "error: $*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

need_command security
need_command xcrun

cd "$ROOT"

echo "LazyGit release signing"
echo "Apple ID: $APPLE_ID"
echo "Team ID:  $TEAM_ID"
echo "Identity: $DEVELOPER_ID_APPLICATION"
echo "Version:  $VERSION"
echo

if ! security find-identity -p codesigning -v | grep -F "\"$DEVELOPER_ID_APPLICATION\"" >/dev/null; then
  fail "Developer ID Application identity is not available in this keychain: $DEVELOPER_ID_APPLICATION"
fi

echo "Checking notarization profile: $NOTARY_PROFILE"
if xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  echo "Using saved notarization profile."
else
  echo "No working notarytool profile named '$NOTARY_PROFILE' was found."
  echo "You will be prompted for an app-specific password for $APPLE_ID."
  echo "Create one at https://account.apple.com/account/manage if needed."
  echo
  xcrun notarytool store-credentials "$NOTARY_PROFILE" \
    --apple-id "$APPLE_ID" \
    --team-id "$TEAM_ID"
fi

export DEVELOPER_ID_APPLICATION
export NOTARYTOOL_PROFILE="$NOTARY_PROFILE"

"$SCRIPT_DIR/package-release.sh" "$VERSION"
