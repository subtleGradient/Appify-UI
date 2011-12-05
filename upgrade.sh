#!/usr/bin/env bash
# lol, hard-coded paths

cd "$(dirname "$0")"

for bin_path in *.app/Contents/MacOS/apache-callback-mac; do
    mv "$bin_path" "$bin_path.old"
    cp "$(ls $HOME/Library/Developer/Xcode/DerivedData/callback-mac-*/Build/Products/Debug/Callback.app/Contents/MacOS/Callback)" "$bin_path"
done

for bin_path in *.app/Contents/MacOS/apache-callback-mac.old; do
    if [[ -f "${bin_path/\.old/}" ]]; then
        rm "$bin_path"
    else
        mv "$bin_path" "${bin_path/\.old/}"
    fi
done

for nib_path in *.app/Contents/Resources/English.lproj/MainMenu.nib; do
    mv "$nib_path" "$nib_path.old"
    cp "$(ls $HOME/Library/Developer/Xcode/DerivedData/callback-mac-*/Build/Products/Debug/Callback.app/Contents/Resources/English.lproj/MainMenu.nib)" "$nib_path"
done

for nib_path in *.app/Contents/Resources/English.lproj/MainMenu.nib.old; do
    if [[ -f "${nib_path/\.old/}" ]]; then
        rm "$nib_path"
    else
        mv "$nib_path" "${nib_path/\.old/}"
    fi
done
