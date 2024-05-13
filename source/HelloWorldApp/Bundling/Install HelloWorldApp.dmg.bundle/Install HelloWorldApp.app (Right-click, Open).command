#!/bin/bash # This is a bash script
#
#   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
#   ┃                                                  ┃
#   ┃                                                  ┃
#   ┃                                                  ┃
#   ┃                                                  ┃
#   ┃           Install the app                        ┃
#   ┃                                                  ┃
#   ┃           HOW?                                   ┃
#   ┃                                                  ┃
#   ┃           1. Right-click on this script          ┃
#   ┃           2. Select "Open"                       ┃
#   ┃           3. See Confirmation dialog             ┃
#   ┃           4. Click "Open"                        ┃
#   ┃                                                  ┃
#   ┃                                                  ┃
#   ┃                                                  ┃
#   ┃                                                  ┃
#   ┡━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
#   │ Why do I need to right-click and select "Open"?  │
#   │ Security. It SHOULD be hard to accidentally run  │
#   │           scripts you find on the internet.      │
#   └──────────────────────────────────────────────────┘
#
#
#       🫡 We always read (and understand) scripts before running them.
#
#
#   Here's how it works:
#   --------------------
#
#   1. Check if the app is already installed...
#
#   2. If it IS already installed...
#
#      - 👀 Compare the installed version with this new version.
#      - ✅ If the installed version is the same as this one, we're done.
#      - 🗑️ Uninstall the old version, if it's different.
#
#   3. If it's NOT already installed...
#
#      - 🔧 Install the new app.
#      - 🦺 Tell macOS that it's safe. (So it won't stop you from opening it)
#      - 📍 Show the user where to find it.
#
#   4. Cleanup
#
#   NOTE: This script is designed to be run from a disk image.
#
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

AppName="HelloWorldApp"                             # The name of the app
App_before_install=".quarantined/$AppName.app"      # The new app is hidden in a folder called .quarantined in the disk image.
App_after_install="$HOME/Applications/$AppName.app" # The app will be installed in the user's personal Applications folder.

RUNTIME_WARNINGS=0

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Next, let's define some functions that we'll use later.

This_stuff_is_safe_I_trust_it() {         # Tell macOS: I trust the app maker and I want to open this app.
  local theApp="$1"                       #
  if [ ! -d "$theApp" ]; then             # Check if the app exists
    RUNTIME_WARNINGS=1                    #
    echo "ERROR: $theApp does not exist." # If it doesn't, show an error message
    return                                # Abort the function
  fi
  # check if the quarantine flag is set
  xattr -p com.apple.quarantine $theApp &>/dev/null || return # If the quarantine flag is not set, we're already done
  xattr -d com.apple.quarantine $theApp                       # Remove the quarantine flag from the app
}

try_to_Install_the_app() {
  if [ -d "$App_after_install" ]; then
    RUNTIME_WARNINGS=1
    echo -en " ${ANSI_RESET}${ANSI_FG_BLUE}"
    echo " Already installed."
    echo " Comparing versions..."
    # Read the version and build number from Info.plist
    NewVersion=$(defaults read "$App_before_install/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null)
    NewBuild=$(defaults read "$App_before_install/Contents/Info.plist" CFBundleVersion 2>/dev/null)
    OldVersion=$(defaults read "$App_after_install/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null)
    OldBuild=$(defaults read "$App_after_install/Contents/Info.plist" CFBundleVersion 2>/dev/null)

    # if versions are identical, do nothing
    if [ "${NewVersion-1}" -eq "${OldVersion-1}" ] && [ "${NewBuild-1}" -eq "${OldBuild-1}" ]; then
      echo " Already up-to-date."
      return
    else
      RUNTIME_WARNINGS=1
      echo " Uninstalling old version..."
      # Remove the old version by moving it to the trash
      mv "$App_after_install" ~/.Trash
    fi
  fi

  cp -r "$App_before_install" "$App_after_install"   # Copy the new app to the Applications folder
  This_stuff_is_safe_I_trust_it "$App_after_install" # Tell macOS that we trust the newly installed app
  psychologically_weighty_progress                   # Pretend to do something important
}

main() {
  cd "$(dirname "$0")" # Focus on the directory of this script

  clear                                # Clear the terminal window
  echo -en "${ANSI_BG_BLUE_FG_WHITE} " # Set the background color to blue and the text color to white
  echo -n "Installing app"             # Print the message "Installing app"

  try_to_Install_the_app

  echo -en " ${ANSI_RESET}${ANSI_FG_BLUE}" # (Reset the styles and set the text color to blue)
  if [ -d "$App_after_install" ]; then     # If the app was installed successfully...
    echo " INSTALLED"
    open --reveal "$App_after_install" # Open the Applications folder and reveal the app
  else
    RUNTIME_WARNINGS=1
    echo " INSTALL FAILED"
  fi

  echo -en "${ANSI_RESET}${ANSI_FG_BLACK}"
  Cleanup_terminal
}

Cleanup_terminal() {
  # skip cleanup unless RUNTIME_WARNINGS=0
  [ $RUNTIME_WARNINGS -eq 0 ] || return
  # once the script is done, we don't need the terminal window anymore, so let's close it
  osascript -l JavaScript ".hidden/cleanup-terminal.jxa.js" &
}

# Show a progress bar
Show_progress() {
  local seconds_total=${1-1}
  local seconds_between_dots=${2-0.1}
  local progress_dot="${3-.}"
  end_time=$((SECONDS + $seconds_total)) # Calculate the end time
  while [ $SECONDS -lt $end_time ]; do   # Loop until the time is up
    sleep $seconds_between_dots          # Wait a bit
    echo -n "$progress_dot"              # Print a dot
  done
}

# Installing the app is pretty much instant
# But psychologically, stuff feels broken if you don't see any progress
# So we'll pretend to do something important for a few seconds
# This gives this process a more natural feel
psychologically_weighty_progress() {
  Show_progress 1 0.025 '.' # Show some dots fast
  Show_progress 1 0.050 '.' # Show some dots a bit slower
  Show_progress 1 0.200 '.' # Show the final dots much slower
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# prepare some styles to make stuff look nice
ANSI_RESET="\033[0m"                # Reset styles
ANSI_BG_BLUE_FG_WHITE="\033[44;37m" # Background Blue, Foreground White
ANSI_FG_BLUE="\033[34m"             # Foreground Blue
ANSI_FG_BLACK="\033[30m"            # Foreground Black

# Finally, run the main function (with all arguments)
main "$@"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Congratulations on making it to the end of this script
