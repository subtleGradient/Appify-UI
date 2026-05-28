# Web Runner Source

This folder is the app-specific source for `Web.app`.

The Bun runner serves `.web` packages and `.web` marker files as static,
browser-native folders. It adds live reload where possible and renders Markdown
files as a convenience without making build tooling part of the `.web` package
contract.

`mkdir Site.web` and `touch Site.web` are both valid authoring shortcuts. On
first open, an empty directory package is filled from
`templates/Untitled.web/`, while an empty file is upgraded into a JSON5 `.web`
manifest with the current Web.app schema URL. Non-empty `.web` files must be
valid manifests:

```js
{
  "$schema": "https://cdn.jsdelivr.net/gh/subtleGradient/Appify-UI@<commit>/Web.app/Contents/Resources/Runner/schema/web-file.schema.json",
  web: 1,
  source: {
    kind: "local",
    root: "@/apps"
  },
}
```

In manifest files, `@/` means the nearest non-home, non-root git worktree root.
Without a git root, generated manifests use `./` relative to the manifest's
parent directory. Git sources are also supported for commit-pinned public GitHub
repos with `source.kind: "git"`, `provider: "github"`, `repo`, `commit`, and
`path`; Web prepares them in a local cache before serving them through the
manifest file's normal `.web` URL route.

When a real `.web` package is inside a normal git repo, the repo root defines
the local URL space while only `.web` package contents are readable. For example,
`apps/dashboard.web` opens at
`http://repo--<root-hash>.localhost:55555/apps/dashboard.web/` and can import or
fetch from `../ui-kit.web/` or `/packages/ui-kit.web/` when those peers exist
under the same repo. If there is no normal git root, Web falls back to sibling
`.web` packages under the opened package's parent directory. A `.git` at the
user's home directory or filesystem root is ignored as ambient state.

Web.app uses WebKit's persistent website data store, so native origin-scoped
state such as IndexedDB, CacheStorage, cookies, service workers, and OPFS stays
with the stable `*.localhost:55555` webspace origin. The injected `localStorage`
facade remains the Web.app document-storage enhancement: ordinary keys are
stored in `<webspace-root>/.local/storage.json5`, while strict `/file.ext` and
`./file.ext` keys can write real files under known writable `.web` routes.

`55555` is the WebKit-visible origin port, not the Runner's required listen
port. Do not make the Runner depend on binding `55555`; it should listen on an
ephemeral private loopback port and let AppifyHost route the visible stable
origin to that backend. For example, WebKit should see
`http://appify-ui--6e3025a4.localhost:55555/ideas.web/`, while AppifyHost may
transport the request to `http://127.0.0.1:<ephemeral>/ideas.web/`.
When WebKit requires an HTTP CONNECT proxy, the Runner may also bind a second
ephemeral loopback tunnel that accepts only the matching stable webspace host
and forwards to the backend. That tunnel is still private transport; Web.app
must never bind TCP port `55555`.

Compatibility behavior is example-driven. Server-ish affordances such as fossil
CGI URLs, form POST handling, SSI, or old AJAX expectations must start with a
checked-in red-case `.web` bundle and follow
[`COMPATIBILITY.md`](COMPATIBILITY.md).

## Hack On It

1. Run `bun test tests/*.test.ts` from this folder.
2. Edit `src/index.ts` or `src/webPackage.ts`.
3. Reopen the package or use View > Reload after runtime changes.

## Clone Into A New App

Copy `Web.app`, rename the bundle, update `Contents/Info.plist`, and tailor the
runner to the static package shape you want. Keep the ready line:
`APPIFY_HOST_OPEN_URL=`. For stable Web.app origins, also keep
`APPIFY_HOST_BACKEND_URL=` and `APPIFY_HOST_PROXY_URL=`.

Credits: Bun serves the local package.
