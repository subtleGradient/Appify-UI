#!bash
cd "$(dirname "$0")"
App=".build/release/HelloWorldApp.app"

mkdir -p $App/Contents/MacOS
mkdir -p $App/Contents/Resources

[[ -f .build/release/HelloWorldApp ]] || swift build -c release
cp .build/release/HelloWorldApp $App/Contents/MacOS
cp Info.plist $App/Contents
