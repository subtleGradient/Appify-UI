AppName="Appify_UI_23"
echo "AppName: $AppName"

BundleRoot="."
SourceAppRoot=".."
SourceAppBuildRoot="$SourceAppRoot/.build/release"
BundleBuildRoot="$BundleRoot/.build"

DiskTemplate="$BundleRoot/Install HelloWorldApp.dmg.bundle"
Disk="$BundleBuildRoot/FakeInstallDisk"
DiskImage="$Disk.dmg"
DiskImageTitle="Install $AppName"
SourceInstallScript="$DiskTemplate/Install HelloWorldApp.app (Right-click, Open).command"
TargetInstallScript="$Disk/Install HelloWorldApp.app (Right-click, Open).command"
App="$Disk/.quarantined/$AppName.app"
SourceAppBuild="$SourceAppBuildRoot/$AppName"
SourceInfoPlist="$SourceAppRoot/Info.plist"
SourceIcon="$SourceAppRoot/Appify UI.icns"
SourceIconSet="../../Appify UI iconset-assets"

Build() {
  # [[ -f "$SourceAppBuild" ]] ||
  swift build -c release -Xswiftc -parse-as-library
}
BuildIcon() {
  rm -rf "$BundleBuildRoot/AppIcon.iconset"
  cp -r "$SourceIconSet" "$BundleBuildRoot/AppIcon.iconset"
  iconutil --convert icns --output "$SourceIcon" "$BundleBuildRoot/AppIcon.iconset"
}
Bundle() {
  rm -rf "$App"
  mkdir -p "$App"
  mkdir -p "$App"/Contents/MacOS
  mkdir -p "$App"/Contents/Resources

  cp "$SourceAppBuild" "$App/Contents/MacOS"
  [[ -f "$SourceInfoPlist" ]] || cp "$SourceAppBuild/Info.plist" "$SourceInfoPlist"
  cp "$SourceInfoPlist" "$App/Contents"
  cp "$SourceIcon" "$App/Contents/Resources"
}
Prepare_disk() {
  echo "Preparing disk"
  rm -rf "$Disk"
  # copy everything from the template, including hidden files and .DS_Store
  mkdir -p "$Disk"
  cp -r "$DiskTemplate"/* "$Disk"
  # WIP
  # cp "$DiskTemplate/.DS_Store" "$Disk"
  ls -lar "$Disk"

  cat "$SourceInstallScript" | sed "s/HelloWorldApp/$AppName/g" >"$TargetInstallScript"
  chmod +x "$TargetInstallScript"

  local TargetInstallScript_next="$Disk/Install $AppName.app (Right-click, Open).command"
  mv "$TargetInstallScript" "$TargetInstallScript_next"
  TargetInstallScript="$TargetInstallScript_next"
}
Create_dmg() {
  echo "Probably use https://github.com/create-dmg/create-dmg to create the disk image instead of this script"
  # TODO: use https://github.com/create-dmg/create-dmg instead
  # wait for the user to press enter
  # echo "You can now customize the disk image template before creating the readonly disk image"
  # read -p "Press enter to open disk image template"
  # open "$Disk"
  # read -p "Press enter to create disk image"

  echo "Creating disk image"
  # xattr -w com.apple.quarantine "0082;$TIMESTAMP;Thomas Aylott;" "$App"

  rm -f "$DiskImage"
  # hdiutil create -srcfolder "$Disk" -volname "$DiskImageTitle" -fs HFS+ -fsargs "-c c=64,a=16,e=16" -format SPARSE -size 5g "$DiskImage"
  hdiutil create -volname "$DiskImageTitle" -srcfolder "$Disk" -ov -format UDZO "$DiskImage"
  xattr -w com.apple.quarantine "0082;$TIMESTAMP;Thomas Aylott;" "$DiskImage"
}
