#!bash
set -e          # exit on error
set -u          # exit on undefined variable
set -o pipefail # exit on pipe error
set -x          # print commands
set -o posix    # more strict failures

cd "$(dirname "$0")"
source ./helpers.lib.sh

AppName="HelloWorldApp"
echo "AppName: $AppName"

DiskTemplate="./Install HelloWorldApp.dmg.bundle"
Disk=".build/FakeInstallDisk"
DiskImage="$Disk.dmg"
DiskImageTitle="Install $AppName"
SourceInstallScript="$DiskTemplate/Install HelloWorldApp.app (Right-click, Open).command"
TargetInstallScript="$Disk/Install HelloWorldApp.app (Right-click, Open).command"
App="$Disk/.quarantined/$AppName.app"
SourceAppBuild="../.build/release/$AppName"
SourceInfoPlist="../Info.plist"

main() {
  clear
  echo -en "${ANSI_BG_BLUE_FG_WHITE}"
  echo -n "Building $AppName"

  Prepare_disk
  Build
  Bundle
  Create_dmg
  open --reveal "$DiskImage"

  echo -en "${ANSI_RESET}${ANSI_FG_BLUE}"
  echo -n " DONE"
  echo -e "${ANSI_RESET}${ANSI_FG_BLACK}"
}

TIMESTAMP=$(printf '%X\n' $(date +%s))

ANSI_BG_BLUE_FG_WHITE="\033[44;37m"
ANSI_FG_BLUE="\033[34m"
ANSI_RESET="\033[0m"
ANSI_FG_BLACK="\033[30m"

main
