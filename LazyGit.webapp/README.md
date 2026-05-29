# LazyGit.webapp

`LazyGit.webapp` is a Webapp.app package for comparing a Bun PTY + wterm
terminal stack against the existing `LazyGit.app` ttyd stack.

The dev server:

- starts a loopback Bun server,
- serves a wterm client,
- opens one guarded `/pty` WebSocket,
- runs `lazygit --path` through Bun's terminal PTY support.

By default it opens the git root above this package. Override the target repo
with:

```sh
LAZYGIT_WEBAPP_REPO_PATH=/path/to/repo bun dev
```

## Security shape

The server generates a fresh session cookie and CSP nonce for each process. The
terminal WebSocket requires an exact same-origin `Origin` header and the
session cookie before it spawns `lazygit`. The client never receives the session
secret in a URL, query parameter, or JavaScript global.

This protects the local PTY from cross-site WebSocket hijacking and accidental
token leakage. It does not protect against script that is already executing in
the same origin.

## Development

```sh
bun install
bun test
bun dev
```
