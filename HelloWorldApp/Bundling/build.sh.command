#!bash
set -e          # exit on error
set -u          # exit on undefined variable
set -o pipefail # exit on pipe error
set -x          # print commands
set -o posix    # more strict failures

cd "$(dirname "$0")"
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

Build() {
  [[ -f "$SourceAppBuild" ]] || swift build -c release
}
Bundle() {
  rm -rf "$App"
  mkdir -p "$App"
  mkdir -p "$App"/Contents/MacOS
  mkdir -p "$App"/Contents/Resources

  cp "$SourceAppBuild" "$App/Contents/MacOS"
  [[ -f "$SourceInfoPlist" ]] || cp "$SourceAppBuild/Info.plist" "$SourceInfoPlist"
  cp "$SourceInfoPlist" "$App/Contents"

  xattr -w com.apple.quarantine "0082;$TIMESTAMP;Thomas Aylott;" "$App"
}
Prepare_disk() {
  echo "Preparing disk"
  rm -rf "$Disk"
  # copy everything from the template, including hidden files and .DS_Store
  cp -r "$DiskTemplate" "$Disk"
  cp "$DiskTemplate/.DS_Store" "$Disk"

  cat "$SourceInstallScript" | sed "s/HelloWorldApp/$AppName/g" >"$TargetInstallScript"
  chmod +x "$TargetInstallScript"

  local TargetInstallScript_next="$Disk/Install $AppName.app (Right-click, Open).command"
  mv "$TargetInstallScript" "$TargetInstallScript_next"
  TargetInstallScript="$TargetInstallScript_next"
}
Create_dmg() {
  # TODO: use https://github.com/create-dmg/create-dmg instead
  # wait for the user to press enter
  # echo "You can now customize the disk image template before creating the readonly disk image"
  # read -p "Press enter to open disk image template"
  # open "$Disk"
  # read -p "Press enter to create disk image"

  echo "Creating disk image"
  rm -f "$DiskImage"
  hdiutil create -srcfolder "$Disk" -volname "$DiskImageTitle" -fs HFS+ -fsargs "-c c=64,a=16,e=16" -format SPARSE -size 5g "$DiskImage"
  # hdiutil create -volname "$DiskImageTitle" -srcfolder "$Disk" -ov -format UDZO "$DiskImage"
  xattr -w com.apple.quarantine "0082;$TIMESTAMP;Thomas Aylott;" "$DiskImage"
}

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
