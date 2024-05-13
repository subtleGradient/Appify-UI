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
  # xattr -w com.apple.quarantine "0082;$TIMESTAMP;Thomas Aylott;" "$App"

  rm -f "$DiskImage"
  hdiutil create -srcfolder "$Disk" -volname "$DiskImageTitle" -fs HFS+ -fsargs "-c c=64,a=16,e=16" -format SPARSE -size 5g "$DiskImage"
  # hdiutil create -volname "$DiskImageTitle" -srcfolder "$Disk" -ov -format UDZO "$DiskImage"
  xattr -w com.apple.quarantine "0082;$TIMESTAMP;Thomas Aylott;" "$DiskImage"
}
