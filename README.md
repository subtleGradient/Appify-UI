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
- [`source/LazyGit/`](source/LazyGit/) is a concrete app built from the same
  impulse: double-click a `.lazygit` package and get `lazygit` running inside a
  narrowed Mac window.
- [`IDEA/web-components-native.idea.htm`](IDEA/web-components-native.idea.htm)
  sketches the bigger possible future: JavaScript as the app brain, SwiftUI as
  the native body, web components as the declaration surface between them.

So the reframe is:

The project is no longer just "wrap a web page in a Mac app." It is becoming a
small family of native document launchers for local tools, allowlisted runners,
and eventually native UI described from web-shaped code.

## Questions before you use it

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

`LazyGit.app` is the first concrete sibling project in the new shape.

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
cd source/LazyGit
swift test
Scripts/build-app.sh
Scripts/smoke-ui.sh
```

The built app lands at:

```text
source/LazyGit/dist/LazyGit.app
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

## The old apps

The older bundles are still useful archaeological layers:

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
`source/AppifyUI2026` and `source/LazyGit`.

## Requirements

Current Swift projects target macOS 14 and use SwiftPM with Swift 6.1 package
manifests.

You will need Apple's command line tools or Xcode. `AppifyUI2026` also needs
`bun` at runtime for `.webapp` packages. `LazyGit` needs either Nix or the direct
terminal/Git tools listed above.

## Project shape

```text
.
├── source/
│   ├── AppifyUI2026/      # SwiftPM .webapp launcher
│   ├── LazyGit/           # SwiftPM .lazygit launcher
│   └── Appify UI 23/      # older SwiftUI/WebKit source
├── IDEA/
│   └── web-components-native.idea.htm
├── Appify UI 2011*.app    # original bundle lineage
├── Appify UI 2023*.app    # rebuilt native innards lineage
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
