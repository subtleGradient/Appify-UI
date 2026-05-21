# Appify UI

Making a tiny Mac app should not feel like starting a religion.

That was the original Appify UI bet: a Mac app is a folder, a plist, a binary,
some web UI, and a script. That was dumb in the useful way. It let one person
turn a local tool into something double-clickable without having to join the
full native-app machinery cult.

The project is moving again, but the point is the same:

Appify UI is for turning local software into real Mac-shaped things.

Not Electron-as-a-city. Not a generic cross-platform fantasy. A small native
shell around the thing that already works, with the operating system doing the
parts the operating system is good at.

## What changed

The old Appify UI apps in this repo are still here as history and working
reference material. They are not the new center.

The new direction lives under `source/`:

- [`source/AppifyUI2026/`](source/AppifyUI2026/) is the fresh SwiftPM Appify UI
  implementation. It opens `.webapp` document packages, validates their
  `webapp.json`, starts an allowlisted, pinned runner with Bun, and loads the
  runner's validated local URL or package-local file URL in a `WKWebView`.
- [`source/TuiHost/`](source/TuiHost/) is the reusable SwiftPM host for local
  terminal UIs. It opens marker package documents, starts `ttyd` on loopback,
  runs a configured TUI command, and keeps the webview on the generated terminal
  URL.
- [`source/LazyGit/`](source/LazyGit/) is the concrete LazyGit packager built on
  `TuiHost`: double-click a `.lazygit` package and get `lazygit` running inside
  a narrowed Mac window.
- [`source/WebappHost/`](source/WebappHost/) is the reusable SwiftPM host for
  app-specific Bun runners bundled inside root `.app` packages.
- [`source/TLCanvasApp/`](source/TLCanvasApp/) is the concrete TLCanvas app:
  double-click a `.tlcanvas` package and get a local canvas editor built with
  the tldraw SDK inside a native WebKit window.
- [`IDEA/web-components-native.idea.htm`](IDEA/web-components-native.idea.htm)
  sketches the bigger possible future: JavaScript as the app brain, SwiftUI as
  the native body, web components as the declaration surface between them.

So the reframe is:

The project is no longer just "wrap a web page in a Mac app." It is becoming a
small family of native document launchers for local tools, allowlisted runners,
and eventually native UI described from web-shaped code.

## Questions before you use it

**Is this serious software or a toy?**

Both, but not in the confusing way.

This is serious software for me. I have used some version of this all day every
day for about 15 years. The serious part is that the idea has survived contact
with real work.

It is also intentionally whimsical, weird, and toy-like in public posture. The
toy part means proof-of-concept, show-and-tell, no implied support contract, no
merge promise, and no security guarantee. The point is to show off what is
working for me in the hope that something like it might work for you too.

**Should I rely on this for important stuff?**

Only if "rely" means you have inspected the code path you care about and are
anchoring yourself to tagged releases. For LazyGit, the current release anchor
is `lazygit-v0.1.0`. This is Good Enough(TM) software, not infrastructure with
a pager attached.

**Do I promise to maintain this for another 11 years?**

Nope. I promise not to pretend that promise exists.

**So why trust it at all?**

Because the shape is small enough to inspect. Trust the code, the tests, tagged
releases, and your own ability to fork it. Not my future calendar.

**Is Appify UI stable now?**

The old idea has been around long enough to inspect. The new implementation is
young. That distinction matters.

**Is this safe?**

Safer than "run arbitrary mystery glue" is not the same as safe.
`AppifyUI2026` narrows what the runner is allowed to look like: manifest type
and version, pinned `github:subtleGradient` runner SHA, validated binary and
argument tokens, and localhost or package-local URL bounds.

**Does LazyGit sandbox `lazygit`?**

No. It gives `lazygit` a Mac-shaped doorway. The actual power is still the local
CLI reading and changing your repo.

**Who should not use this?**

If you need a polished consumer app, a cross-platform runtime, an updater,
a marketplace, a support contract, or an enterprise security story, use
something boring and established.

## No pull requests

I do not accept pull requests for this repo anymore.

Patches are good, generally. But for toy software like this, a PR button makes me feel like I'm promising to review, secure,
merge, and maintain stuff forever.

i WANT to promise that, but the 2026 AI threat model is too large, I do not
have the attention to guarantee security review, and I am too much of a
perfectionist to pretend otherwise. So I disabled PRs to avoid lying that I'm going to maintain this like a real OSS project. It's not "real" it's just a silly goofy toy that just happens to be SUPER useful for me

Fork it. Change anything. Ship your version. Brag. Show me what you made. I may
copy your ideas someday.

Do not wait for me

Issues are still welcome !! Bugs, praise, feedback, ideas, random chatter,
screenshots, "look what I made" notes: yes. Please. I am desperate to see other
kool kids do cool stuff with stuff like this. An issue does not imply a
response, fix, roadmap slot, support obligation, or security review. It just
keeps the hallway open without pretending there is a merge queue behind it.

## AppifyUI2026

`AppifyUI2026` is the next Appify UI core.

A `.webapp` is a macOS package folder with a lowercase `webapp.json` file. The
manifest says which allowlisted, pinned runner should open the package. The app
validates the manifest, resolves `bun`, runs the runner, waits for it to print a
validated local URL, then loads that URL in a WebKit window.

The trust model is intentionally narrow:

- manifest type must be `appify.webapp`
- manifest version must be `1`
- runner packages must come from `github:subtleGradient/...`
- runner packages must be pinned to a full 40-character commit SHA
- runner binary and argument tokens are validated before execution
- HTTP(S) URLs must stay on localhost or loopback
- `file://` URLs must stay inside the `.webapp` package

Build and test it:

```sh
cd source/AppifyUI2026
swift test
Scripts/build-app.sh
Scripts/smoke-ui.sh
```

The built app lands at:

```text
source/AppifyUI2026/dist/Appify UI.app
```

There is a small fixture at
[`source/AppifyUI2026/Fixtures/Hello.webapp`](source/AppifyUI2026/Fixtures/Hello.webapp/).

Runtime logs go to:

```text
~/Library/Logs/Appify-UI
```

## LazyGit

`LazyGit.app` is the first concrete sibling project in the new shape. It is now
configured on top of the generic `TuiHost` runner.

It declares `.lazygit` as a Finder package. A `.lazygit` package is only a marker
folder; the actual working directory is the package's parent folder. Open the
package and LazyGit starts a local `ttyd` terminal, runs `lazygit --path` for the
parent folder, and shows it in a non-persistent `WKWebView`.

That means it operates on the repo next to the `.lazygit` marker. This is not a
sandbox around Git. It is a smaller doorway into the same local power you get
when you run `lazygit` yourself.

This is the project direction in miniature:

Take a powerful local CLI tool. Give it a double-clickable document package.
Keep the native wrapper small. Narrow the URL surface. Clean up the process
tree when the window closes.

`LazyGit` prefers `nix-shell` when available. Without Nix, it looks for direct
installations of:

- `ttyd`
- `lazygit`
- `git`
- `git-lfs`

Build and test it:

```sh
cd source/TuiHost
swift test

cd source/LazyGit
Scripts/build-app.sh
Scripts/smoke-ui.sh
```

The built app lands at:

```text
source/LazyGit/dist/LazyGit.app
```

The checked-in developer bundle can be refreshed with:

```sh
cd source/LazyGit
Scripts/build-root-app.sh
```

That writes:

```text
LazyGit.app
```

Release packaging is stricter on purpose:

```sh
cd source/LazyGit
DEVELOPER_ID_APPLICATION="Developer ID Application: Example, Inc. (TEAMID)" \
NOTARYTOOL_PROFILE="notarytool-profile-name" \
Scripts/package-release.sh 0.1.0
```

That signs with Developer ID hardened runtime, submits the zip for Apple
notarization, staples the ticket, validates with `spctl`, and emits:

```text
source/LazyGit/dist/release/LazyGit.app.zip
```

Runtime logs go to:

```text
~/Library/Logs/LazyGit
```

## TLCanvas

`TLCanvas.app` is the first concrete `WebappHost` app. It declares `.tlcanvas` as a
Finder package, starts the bundled Bun runner, waits for a validated local URL,
and shows that runner in a native WebKit window.

TLCanvas is not affiliated with or endorsed by tldraw Inc. It is a local
developer bundle built with the official [tldraw SDK](https://tldraw.dev), keeps
tldraw's own SDK UI intact, and does not include a production license key.
Production distribution is a licensing checkpoint.

The root `TLCanvas.app` intentionally does not vendor `node_modules`. The package
source and `bun.lock` are the source of truth. On first run, the launcher
resolves Bun directly or through `nix-shell -p bun`, then installs app-local
dependencies with `bun install --frozen-lockfile`.

Build and test it:

```sh
cd source/WebappHost
swift test

cd ../TLCanvasApp/Runner
bun install --frozen-lockfile
bun test tests/*.test.ts

cd ..
Scripts/build-app.sh
Scripts/smoke-ui.sh
```

The checked-in developer bundle can be refreshed with:

```sh
cd source/TLCanvasApp
Scripts/build-root-app.sh
```

That writes:

```text
TLCanvas.app
```

## The old apps

The older bundles are still useful archaeological layers. They now live under
[`archive/legacy-apps/`](archive/legacy-apps/) so the repo root only contains
modern, self-bootstrapping apps:

- `Appify UI 2011.app`
- `Appify UI 2011 Demo.app`
- `Appify UI 2011 Node Demo.app`
- `Appify UI 2011 Deno Demo.app`
- `Appify UI 2023.app`
- `Appify UI 2023 Deno.app`
- `Appify AI.app`
- `Hello AI.app`

They show the original promise: HTML for the surface, scripts or local runtimes
for behavior, Cocoa enough to make it feel like a Mac app.

But if you are trying to understand where the project is going now, start with
`LazyGit.app`, `TLCanvas.app`, and their canonical sources under `source/`.

## Requirements

Current Swift projects target macOS 14 and use SwiftPM with Swift 6.1 package
manifests.

You will need Apple's command line tools or Xcode. `AppifyUI2026` also needs
`bun` at runtime for `.webapp` packages. `LazyGit` needs either Nix or the direct
terminal/Git tools listed above. `TLCanvas.app` needs direct Bun or Nix so it can
install its lockfile-pinned runner dependencies.

The dependency posture is deliberately boring: source plus lockfiles are
canonical, the internet is allowed, npm/Bun/nixpkgs may fetch dependencies on
demand, and Git LFS is reserved for future large non-regenerable assets only.

The root apps are checked-in developer artifacts. Their bundled source snapshots
are generated from `source/`, and their host binaries are keyed by source hashes
instead of mtimes so a fresh clone does not rebuild merely because file
timestamps changed.

## Project shape

```text
.
├── source/
│   ├── AppifyUI2026/      # SwiftPM .webapp launcher
│   ├── TuiHost/           # SwiftPM TUI host
│   ├── LazyGit/           # .lazygit concrete app packager
│   ├── WebappHost/        # SwiftPM bundled Bun runner host
│   ├── TLCanvasApp/       # .tlcanvas concrete app packager and runner
│   └── Appify UI 23/      # older SwiftUI/WebKit source
├── archive/
│   └── legacy-apps/       # original bundle lineage
├── IDEA/
│   └── web-components-native.idea.htm
├── LazyGit.app            # checked-in self-compiling TuiHost bundle
├── TLCanvas.app           # checked-in self-compiling WebappHost bundle
├── Scripts/
│   └── verify-root-apps.sh
└── README.md
```

## Similar projects

- <https://github.com/MacGapProject/MacGap2>
- <https://github.com/nwjs/nw.js>
- <https://github.com/sveinbjornt/Platypus>

Those are probably still what many people should use.

Appify UI is the stubborn smaller thing: local tools, native document packages,
WebKit where it helps, SwiftUI where it belongs, and as little machinery as
possible between an idea and a double-clickable Mac app.
