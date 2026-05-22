# Appify UI

Making a tiny Mac app should not feel like starting a religion.

Appify UI is for turning local software into real Mac-shaped things: a small
native shell around the tool that already works, with the operating system doing
the parts the operating system is good at.

Not Electron-as-a-city. Not a generic cross-platform fantasy. A folder-shaped
Mac app, a tiny host, a local runner, and as little ceremony as possible between
an idea and a double-clickable thing.

## Current Shape

The repo is intentionally object-first:

```text
.
├── LazyGit.app
├── LogScope.app
├── TLCanvas.app
├── litecli.app
├── tw.app
├── source/
│   └── AppifyHost/
├── Scripts/
│   └── verify-root-apps.sh
└── README.md
```

The rule is simple:

- `*.app/` contains everything specific to that app: runtime payloads, app
  servers, runners, scripts, fixtures, docs, and developer tooling.
- `source/AppifyHost/` contains the shared SwiftPM document host used by the app
  bundles.
- Git history carries old experiments. The main tree stays clean.

## Apps

[`LazyGit.app`](LazyGit.app/) opens `.lazygit` marker packages. The marker lives
inside a repo folder; the app starts `ttyd`, runs `lazygit --path` for that repo,
and shows it in a native WebKit window.

[`LogScope.app`](LogScope.app/) opens log-shaped files including `.log`, `.out`,
`.err`, `.trace`, `.jsonl`, and `.ndjson`. It starts `ttyd`, runs `lnav`, and
shows the indexed log timeline in a native WebKit window.

[`TLCanvas.app`](TLCanvas.app/) opens `.tlcanvas` document packages. Its bundled
Runner is the canonical TLCanvas source, including the tldraw SDK app, server,
tests, schema, and lockfile.

[`tw.app`](tw.app/) opens tabular data files supported by Tabiew, including CSV,
TSV, Parquet, JSON, JSONL, Arrow, FWF, SQLite, and Excel files. It starts
`ttyd`, runs `tw`, and shows Tabiew in a native WebKit window.

[`litecli.app`](litecli.app/) opens `.db`, `.sqlite`, and `.sqlite3` files. It
starts `ttyd`, runs `litecli`, and opens the selected SQLite database through a
read-only SQLite URI.

`source/AppifyHost` is the shared host layer. It knows how to open macOS
documents, start an app-bundled server command, wait for `APPIFY_HOST_OPEN_URL`,
validate that URL, and show it in a native WebKit window. It does not know about
LazyGit, Tabiew, LiteCLI, TLCanvas, Bun, `ttyd`, or tldraw.

## Build

Shared host:

```sh
cd source/AppifyHost
swift test
```

LazyGit:

```sh
cd LazyGit.app/Contents/Developer
Scripts/build-app.sh
Scripts/smoke-ui.sh
```

LogScope:

```sh
cd LogScope.app/Contents/Developer
Scripts/build-root-app.sh
Scripts/smoke-menus.jxa.js "$PWD/../.." com.subtlegradient.logscope LogScope
```

tw:

```sh
cd tw.app/Contents/Developer
Scripts/build-root-app.sh
Scripts/smoke-menus.jxa.js "$PWD/../.." com.subtlegradient.tw tw
```

litecli:

```sh
cd litecli.app/Contents/Developer
Scripts/build-root-app.sh
Scripts/smoke-menus.jxa.js "$PWD/../.." com.subtlegradient.litecli litecli
```

TLCanvas:

```sh
cd TLCanvas.app/Contents/Resources/Runner
bun install --frozen-lockfile
bun test tests/*.test.ts
bun build src/index.html --outdir /private/tmp/tlcanvas-runner-build

cd ../../Developer
Scripts/build-app.sh
Scripts/smoke-ui.sh
```

Verify the checked-in root apps:

```sh
Scripts/verify-root-apps.sh
```

## History

The old apps and experiments are archived by git, not by folders in the current
tree. The pre-cleanup snapshot is:

[`archive/pre-cleanup-2026-05-21`](https://github.com/subtleGradient/Appify-UI/tree/archive/pre-cleanup-2026-05-21)

Useful landmarks inside that tag:

- [legacy app bundles](https://github.com/subtleGradient/Appify-UI/tree/archive/pre-cleanup-2026-05-21/archive/legacy-apps)
- [AppifyUI2026 `.webapp` experiment](https://github.com/subtleGradient/Appify-UI/tree/archive/pre-cleanup-2026-05-21/source/AppifyUI2026)
- [WebappHost experiment](https://github.com/subtleGradient/Appify-UI/tree/archive/pre-cleanup-2026-05-21/source/WebappHost)
- [Appify UI 23](https://github.com/subtleGradient/Appify-UI/tree/archive/pre-cleanup-2026-05-21/source/Appify%20UI%2023)
- [web-components-native idea sketch](https://github.com/subtleGradient/Appify-UI/tree/archive/pre-cleanup-2026-05-21/IDEA)

To pull any old artifact back locally:

```sh
git checkout archive/pre-cleanup-2026-05-21 -- path/to/thing
```

## Boundaries

This is serious software for me and intentionally toy-like in public posture.
It is useful, inspectable, forkable, and not a support contract.

I do not accept pull requests for this repo anymore. Issues are still welcome:
bugs, notes, screenshots, ideas, and "look what I made" chatter are all useful
signal. An issue does not imply a response, fix, roadmap slot, support
obligation, merge, or security review.

Fork it. Change anything. Ship your version. Brag. Do not wait for me.

## Similar Projects

- <https://github.com/MacGapProject/MacGap2>
- <https://github.com/nwjs/nw.js>
- <https://github.com/sveinbjornt/Platypus>

Those are probably still what many people should use.

Appify UI is the stubborn smaller thing: local tools, native document packages,
WebKit where it helps, SwiftUI where it belongs, and as little machinery as
possible between an idea and a double-clickable Mac app.
