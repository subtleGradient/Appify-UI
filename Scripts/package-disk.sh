#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/Scripts/appify-host-lib.sh"

usage() {
  cat >&2 <<'USAGE'
Usage: Scripts/package-disk.sh <Root.app> --output <Path> [options]

Options:
  --output-kind dmg|media-folder     Output a compressed DMG or staged media folder. Default: dmg.
  --volume-name NAME                 Finder volume name. Default: app display name.
  --sign -|IDENTITY                  Sign the app ad hoc or with an identity. Default: -.
  --no-sign                          Do not sign the app.
  --notarize                         Submit Developer ID artifacts to Apple notary service.
  --no-notarize                      Skip notarization. Default unless --sign is Developer ID Application.
  --notary-profile PROFILE           notarytool keychain profile. Defaults to NOTARYTOOL_PROFILE.
  --background PATH                  Optional Finder background image copied into .background/.
  --volume-icon PATH                 Optional .icns copied to .VolumeIcon.icns.
  --readme PATH                      Optional README copied to the volume root.
  --license PATH                     Optional license file copied to the volume root.
USAGE
  exit 2
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || appify_fail "Missing required command: $1"
}

copy_optional_file() {
  local source="$1"
  local destination="$2"
  [[ -z "$source" ]] && return 0
  [[ -f "$source" ]] || appify_fail "Missing file: $source"
  cp "$source" "$destination"
}

should_notarize() {
  case "$NOTARIZE" in
    1)
      return 0
      ;;
    0)
      return 1
      ;;
    auto)
      [[ "$SIGN_IDENTITY" == Developer\ ID\ Application:* ]]
      return
      ;;
    *)
      appify_fail "Invalid notarization mode: $NOTARIZE"
      ;;
  esac
}

codesign_path() {
  local path="$1"
  if [[ "$SIGN_IDENTITY" == "-" ]]; then
    codesign --force --sign - "$path"
  else
    codesign --force --timestamp --options runtime --sign "$SIGN_IDENTITY" "$path"
  fi
}

sign_app_bundle() {
  local app="$1"
  [[ -n "$SIGN_IDENTITY" ]] || return 0
  need_command codesign
  need_command file

  while IFS= read -r -d '' file_path; do
    if file "$file_path" | grep -q 'Mach-O'; then
      codesign_path "$file_path"
    fi
  done < <(find "$app/Contents" -type f -print0)

  codesign_path "$app"
  codesign --verify --deep --strict --verbose=2 "$app"
}

notary_submit() {
  local artifact="$1"
  need_command xcrun

  local notary_args=(notarytool submit "$artifact" --wait)
  if [[ -n "$NOTARY_PROFILE" ]]; then
    notary_args+=(--keychain-profile "$NOTARY_PROFILE")
  elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_TEAM_ID:-}" && -n "${APP_SPECIFIC_PASSWORD:-}" ]]; then
    notary_args+=(--apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APP_SPECIFIC_PASSWORD")
  else
    appify_fail "No notarization credentials found. Set --notary-profile, NOTARYTOOL_PROFILE, or APPLE_ID, APPLE_TEAM_ID, and APP_SPECIFIC_PASSWORD."
  fi

  xcrun "${notary_args[@]}"
}

notarize_app_bundle() {
  local app="$1"
  local archive="$STAGING_ROOT/app-notary-upload.zip"
  need_command ditto
  need_command spctl
  ditto -c -k --keepParent "$app" "$archive"
  notary_submit "$archive"
  xcrun stapler staple "$app"
  xcrun stapler validate "$app"
  spctl --assess --type execute --verbose=4 "$app"
}

first_mount_point() {
  local plist="$1"
  need_command plutil
  local index mount_point
  for index in {0..20}; do
    mount_point="$(plutil -extract "system-entities.$index.mount-point" raw "$plist" 2>/dev/null || true)"
    if [[ -n "$mount_point" && "$mount_point" != "null" ]]; then
      printf '%s\n' "$mount_point"
      return 0
    fi
  done
  return 1
}

customize_mounted_volume() {
  local mount_point="$1"
  [[ -d "$mount_point" ]] || return 0

  if [[ -f "$mount_point/.VolumeIcon.icns" ]] && command -v SetFile >/dev/null 2>&1; then
    SetFile -a C "$mount_point" || true
  fi

  command -v osascript >/dev/null 2>&1 || return 0
  osascript - "$VOLUME_NAME" "$APP_BUNDLE_NAME" "$BACKGROUND_BASENAME" >/dev/null 2>&1 <<'APPLESCRIPT' || true
on run argv
  set volumeName to item 1 of argv
  set appName to item 2 of argv
  set backgroundName to item 3 of argv
  tell application "Finder"
    tell disk volumeName
      open
      set current view of container window to icon view
      set toolbar visible of container window to false
      set statusbar visible of container window to false
      set bounds of container window to {120, 120, 760, 520}
      set viewOptions to icon view options of container window
      set icon size of viewOptions to 96
      set arrangement of viewOptions to not arranged
      if backgroundName is not "" then
        set background picture of viewOptions to file (".background:" & backgroundName) of disk volumeName
      end if
      set position of item appName of container window to {180, 190}
      try
        set position of item "Applications" of container window to {500, 190}
      end try
      close
      update without registering applications
    end tell
  end tell
end run
APPLESCRIPT
}

create_dmg() {
  local output="$1"
  need_command hdiutil

  local rw_dmg="$STAGING_ROOT/$VOLUME_NAME.rw.dmg"
  local compressed_dmg="$STAGING_ROOT/$VOLUME_NAME.dmg"
  local attach_plist="$STAGING_ROOT/attach.plist"
  local mount_point=""

  hdiutil create \
    -srcfolder "$VOLUME_ROOT" \
    -volname "$VOLUME_NAME" \
    -fs HFS+ \
    -format UDRW \
    -ov \
    "$rw_dmg" >/dev/null

  hdiutil attach -readwrite -noverify -noautoopen -plist "$rw_dmg" > "$attach_plist"
  mount_point="$(first_mount_point "$attach_plist" || true)"
  if [[ -n "$mount_point" ]]; then
    customize_mounted_volume "$mount_point"
    sync
    hdiutil detach "$mount_point" >/dev/null
  fi

  hdiutil convert "$rw_dmg" -format UDZO -imagekey zlib-level=9 -o "$compressed_dmg" -ov >/dev/null
  hdiutil verify "$compressed_dmg" >/dev/null

  if should_notarize; then
    notary_submit "$compressed_dmg"
    xcrun stapler staple "$compressed_dmg"
    xcrun stapler validate "$compressed_dmg"
  fi

  rm -f "$output"
  mv "$compressed_dmg" "$output"
}

[[ $# -ge 1 ]] || usage

SOURCE_APP_INPUT="$1"
shift

OUTPUT=""
OUTPUT_KIND="dmg"
VOLUME_NAME=""
SIGN_IDENTITY="-"
NOTARIZE="auto"
NOTARY_PROFILE="${NOTARYTOOL_PROFILE:-}"
BACKGROUND=""
VOLUME_ICON=""
README_FILE=""
LICENSE_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      [[ $# -ge 2 ]] || usage
      OUTPUT="$2"
      shift 2
      ;;
    --output-kind)
      [[ $# -ge 2 ]] || usage
      OUTPUT_KIND="$2"
      shift 2
      ;;
    --volume-name)
      [[ $# -ge 2 ]] || usage
      VOLUME_NAME="$2"
      shift 2
      ;;
    --sign)
      [[ $# -ge 2 ]] || usage
      SIGN_IDENTITY="$2"
      shift 2
      ;;
    --no-sign)
      SIGN_IDENTITY=""
      NOTARIZE="0"
      shift
      ;;
    --notarize)
      NOTARIZE="1"
      shift
      ;;
    --no-notarize)
      NOTARIZE="0"
      shift
      ;;
    --notary-profile)
      [[ $# -ge 2 ]] || usage
      NOTARY_PROFILE="$2"
      shift 2
      ;;
    --background)
      [[ $# -ge 2 ]] || usage
      BACKGROUND="$2"
      shift 2
      ;;
    --volume-icon)
      [[ $# -ge 2 ]] || usage
      VOLUME_ICON="$2"
      shift 2
      ;;
    --readme)
      [[ $# -ge 2 ]] || usage
      README_FILE="$2"
      shift 2
      ;;
    --license)
      [[ $# -ge 2 ]] || usage
      LICENSE_FILE="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n "$OUTPUT" ]] || usage
[[ -d "$SOURCE_APP_INPUT" ]] || appify_fail "Missing source app: $SOURCE_APP_INPUT"

case "$OUTPUT_KIND" in
  dmg|media-folder)
    ;;
  *)
    appify_fail "--output-kind must be dmg or media-folder."
    ;;
esac

SOURCE_APP="$(cd "$SOURCE_APP_INPUT" && pwd)"
APP_DISPLAY_NAME="$(appify_app_name "$SOURCE_APP")"
APP_BUNDLE_NAME="$(basename "$SOURCE_APP")"
VOLUME_NAME="${VOLUME_NAME:-$APP_DISPLAY_NAME}"

OUTPUT_PARENT="$(dirname "$OUTPUT")"
OUTPUT_BASENAME="$(basename "$OUTPUT")"
mkdir -p "$OUTPUT_PARENT"
OUTPUT_PARENT="$(cd "$OUTPUT_PARENT" && pwd)"
OUTPUT="$OUTPUT_PARENT/$OUTPUT_BASENAME"

case "$OUTPUT_KIND" in
  dmg)
    [[ "$OUTPUT" == *.dmg ]] || appify_fail "DMG output must end with .dmg."
    ;;
  media-folder)
    [[ "$OUTPUT" != *.app ]] || appify_fail "media-folder output must be a folder, not an .app path."
    ;;
esac
if [[ "$OUTPUT" == "$ROOT" || "$OUTPUT" == "$ROOT/"* ]]; then
  appify_fail "Output must be outside the repository."
fi

if should_notarize && [[ -z "$SIGN_IDENTITY" || "$SIGN_IDENTITY" == "-" ]]; then
  appify_fail "Notarization requires a Developer ID signing identity."
fi

STAGING_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/appify-disk.XXXXXX")"
cleanup() {
  rm -rf "$STAGING_ROOT"
}
trap cleanup EXIT

STANDALONE_APP="$STAGING_ROOT/$APP_BUNDLE_NAME"
VOLUME_ROOT="$STAGING_ROOT/volume"
BACKGROUND_BASENAME=""

"$ROOT/Scripts/eject-app.sh" "$SOURCE_APP" --output "$STANDALONE_APP" --no-sign >/dev/null
sign_app_bundle "$STANDALONE_APP"
if should_notarize; then
  notarize_app_bundle "$STANDALONE_APP"
fi

mkdir -p "$VOLUME_ROOT"
ditto "$STANDALONE_APP" "$VOLUME_ROOT/$APP_BUNDLE_NAME"
ln -s /Applications "$VOLUME_ROOT/Applications"

if [[ -n "$BACKGROUND" ]]; then
  [[ -f "$BACKGROUND" ]] || appify_fail "Missing background image: $BACKGROUND"
  BACKGROUND_BASENAME="$(basename "$BACKGROUND")"
  mkdir -p "$VOLUME_ROOT/.background"
  cp "$BACKGROUND" "$VOLUME_ROOT/.background/$BACKGROUND_BASENAME"
fi
copy_optional_file "$VOLUME_ICON" "$VOLUME_ROOT/.VolumeIcon.icns"
copy_optional_file "$README_FILE" "$VOLUME_ROOT/$(basename "${README_FILE:-README}")"
copy_optional_file "$LICENSE_FILE" "$VOLUME_ROOT/$(basename "${LICENSE_FILE:-LICENSE}")"

case "$OUTPUT_KIND" in
  media-folder)
    rm -rf "$OUTPUT"
    mv "$VOLUME_ROOT" "$OUTPUT"
    ;;
  dmg)
    create_dmg "$OUTPUT"
    ;;
esac

echo "$OUTPUT"
