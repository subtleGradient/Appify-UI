# LazyGit App Source

This folder is the app-specific source for `LazyGit.app`.

`main.sh` starts a loopback `ttyd` server and runs `lazygit --path` in the
folder that contains the opened `.lazygit` marker package. The shared Swift host
only opens the document, starts this script, waits for `APPIFY_HOST_OPEN_URL`,
and embeds that local URL in WebKit.

## Hack On It

1. Edit `main.sh` to change how the terminal server is started.
2. Use a `.lazygit` marker package inside a git repository as the document.
3. Reopen the document or use View > Reload after changing runtime behavior.

## Clone Into A New App

Copy `LazyGit.app`, rename the bundle, update `Contents/Info.plist`, and replace
this folder with the command you want to expose. Keep the script printing one
`APPIFY_HOST_OPEN_URL=` line once the local server is ready.

Credits: LazyGit, git, git-lfs, and ttyd do the app-specific runtime work.
