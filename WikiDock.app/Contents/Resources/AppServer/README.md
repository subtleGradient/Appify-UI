# WikiDock App Source

This folder is the app-specific source for `WikiDock.app`.

`main.sh` ensures the opened `.tiddlywiki` package is a TiddlyWiki folder,
initializes empty packages when appropriate, starts the TiddlyWiki Node.js CLI,
and prints the ready loopback URL for the shared host. Related starter material
lives in `../Templates`.

## Hack On It

1. Edit `main.sh` to change validation, initialization, or TiddlyWiki startup.
2. Edit `../Templates` to change bundled package starters.
3. Reopen the wiki or use View > Reload after runtime changes.

## Clone Into A New App

Copy `WikiDock.app`, rename the bundle, update `Contents/Info.plist`, and adjust
this folder for the package type you want to serve. The host contract is still
one ready line: `APPIFY_HOST_OPEN_URL=`.

Credits: TiddlyWiki provides the wiki runtime.
