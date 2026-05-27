# LogScope App Source

This folder is the app-specific source for `LogScope.app`.

`main.sh` starts `ttyd`, runs `lnav` against the opened log-shaped file, and
prints the loopback `APPIFY_HOST_OPEN_URL` consumed by the shared Swift host.

## Hack On It

1. Edit `main.sh` to change the `lnav` invocation, timeout, or terminal flags.
2. Open a `.log`, `.out`, `.err`, `.trace`, `.jsonl`, or `.ndjson` file.
3. Reopen the document or use View > Reload after runtime changes.

## Clone Into A New App

Copy `LogScope.app`, change the bundle identity and document types in
`Contents/Info.plist`, then swap the command in `main.sh`. Any clone should keep
the local-server contract: print `APPIFY_HOST_OPEN_URL=` only after the server is
ready.

Credits: lnav provides log navigation; ttyd provides the browser terminal.
