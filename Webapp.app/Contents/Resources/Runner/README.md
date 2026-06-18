# Webapp Runner Source

This folder is the app-specific source for `Webapp.app`.

The Bun runner opens `.webapp` package folders, scaffolds minimal package
metadata when needed, requests native AppifyHost gate approval before running
package code, starts `bun --no-install run dev`, and loads the first loopback
URL printed by the dev process. If dependencies are present and Webapp can tell
its own previous install is missing or stale, the user gets one just-in-time
prompt for `bun install` followed by `bun --no-install run dev`; if
`node_modules` already exists without a Webapp marker, it is treated as
user-managed and Webapp does not install. Dev and install+dev approvals are
fingerprinted and stored in `~/.local/webappapp.json5` using `Bun.JSON5`.

The AppifyHost gate channel is a private per-runner file channel. Webapp fails
closed when the channel is absent or malformed, and strips the gate environment
before spawning `bun install` or `bun --no-install run dev` so package code
cannot trigger native prompts directly.

For HTTP loopback dev servers, Webapp uses the same visible-origin pattern as
Web.app: WebKit loads a stable `*.localhost:55555` URL, while AppifyHost routes
that origin through a private CONNECT tunnel to the dev server's ephemeral
loopback port. The dev server URL is logged as `APPIFY_HOST_BACKEND_URL=`, the
tunnel as `APPIFY_HOST_PROXY_URL=`, and the stable visible URL as
`APPIFY_HOST_OPEN_URL=`. HTTPS loopback dev servers are loaded directly for now
because preserving TLS through a rewritten localhost name requires certificate
coordination that normal Bun dev servers do not provide.

Webapp uses WebKit's persistent website data store so browser-native state is
stable per package origin. It does not inherit Web.app's static bundle
manifesting, peer `.web` mounting, Markdown rendering, or file-backed
`localStorage` facade; `.webapp` is the explicit Bun lifecycle boundary.

## Hack On It

1. Run `bun test tests/*.test.ts` from this folder.
2. Edit `src/index.ts` or `src/webappPackage.ts`.
3. Reopen the package or use View > Reload after runtime changes.

## Clone Into A New App

Copy `Webapp.app`, rename the bundle, update `Contents/Info.plist`, and specialize
the runner around a framework, template, or dev command. Keep stdout producing a
ready URL for the shared host.

Credits: Bun provides package resolution and dev-server execution.
