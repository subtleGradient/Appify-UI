#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/dist/Appify UI.app"
EXPECTED_BUNDLE_IDENTIFIER="com.subtlegradient.AppifyUI2026"

if [[ "${APPIFY_SMOKE_SKIP_BUILD:-0}" != "1" ]]; then
  "$ROOT/Scripts/build-app.sh" >/dev/null
fi

if [[ ! -x "$APP/Contents/MacOS/Appify UI" ]]; then
  echo "Missing executable app bundle at $APP" >&2
  exit 1
fi

codesign -vvv --deep --strict "$APP" >/dev/null

osascript - "$APP" "$EXPECTED_BUNDLE_IDENTIFIER" <<'APPLESCRIPT'
on run argv
  set appPath to item 1 of argv
  set expectedBundleIdentifier to item 2 of argv
  set deadline to (current date) + 8

  try
    tell application "Appify UI" to quit
    delay 0.2
  end try

  try
    do shell script "open -n " & quoted form of appPath

    tell application "System Events"
      repeat until exists process "Appify UI"
        if (current date) > deadline then error "Appify UI process did not appear"
        delay 0.1
      end repeat

      tell process "Appify UI"
        set frontmost to true

        repeat until bundle identifier is expectedBundleIdentifier
          if (current date) > deadline then error "Appify UI bundle identifier was not visible"
          delay 0.1
        end repeat

        if bundle identifier is not expectedBundleIdentifier then
          error "Expected bundle identifier " & expectedBundleIdentifier & " but saw " & bundle identifier
        end if

        repeat until frontmost
          if (current date) > deadline then error "Appify UI process is not frontmost"
          delay 0.1
        end repeat

        if not (exists menu bar 1) then error "Appify UI has no menu bar"
        if not (exists menu bar item "File" of menu bar 1) then error "Appify UI has no File menu"
        if not (exists menu bar item "Appify UI" of menu bar 1) then error "Appify UI has no application menu"

        repeat until (count of windows) > 0
          if (current date) > deadline then error "Appify UI did not present a window or open panel"
          delay 0.1
        end repeat

        if name of window 1 is not "Open Web App" then
          error "Expected direct-launch open panel named Open Web App but saw " & name of window 1
        end if
      end tell
    end tell

    tell application "Appify UI" to quit
    return "Appify UI smoke ok: " & appPath
  on error errorMessage number errorNumber
    try
      tell application "Appify UI" to quit
    end try
    error errorMessage number errorNumber
  end try
end run
APPLESCRIPT
