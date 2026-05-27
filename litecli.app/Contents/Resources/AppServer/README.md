# litecli App Source

This folder is the app-specific source for `litecli.app`.

`main.sh` converts the selected SQLite file into a read-only SQLite URI, starts
`ttyd`, runs `litecli`, and prints the ready loopback URL for the shared host.
`liteclirc` contains the bundled litecli configuration.

## Hack On It

1. Edit `main.sh` to change the database URI, prompt, terminal flags, or startup
   behavior.
2. Edit `liteclirc` to change the litecli experience.
3. Reopen the database or use View > Reload after runtime changes.

## Clone Into A New App

Copy `litecli.app`, change bundle identity and document types in
`Contents/Info.plist`, then replace this folder with the database command you
want. Keep the `APPIFY_HOST_OPEN_URL=` ready signal.

Credits: litecli provides the SQLite shell; ttyd provides the browser terminal.
