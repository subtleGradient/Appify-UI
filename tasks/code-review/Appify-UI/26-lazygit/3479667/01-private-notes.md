## Code Review Log - 26-lazygit

### 1. Incentive (Hypothesis)
- Claim: The standalone LazyGit.app should safely open `.lazygit` marker packages and expose lazygit only through a local WKWebView terminal.
- Evidence: `source/LazyGit/Sources/LazyGit/AppDelegate.swift`, `source/LazyGit/Sources/LazyGit/TerminalWindowController.swift`, `source/LazyGit/Sources/LazyGitCore/LazyGitCore.swift`.

### 2. Adversarial Attack (Falsification)
- [risky] Localhost drive-by risk: after Basic Auth was removed for WKWebView compatibility, any browser process able to discover the random port could hit ttyd's root path. `--check-origin` helps WebSocket origin checks, but path discovery still had no second capability.
- [risky] Logs leaked the full runner command. Any future path capability or token in command args would be exposed in `~/Library/Logs/LazyGit`.
- [risky] `ttyd` reconnect loops could repeatedly respawn a crashing child command when the selected directory is not usable by lazygit.
- [risky] Inherited shell and dynamic-loader environment (`BASH_ENV`, `ENV`, `DYLD_*`, `LD_*`) crossed into `nix-shell --run` and direct ttyd launches.
- [investigated] Shell injection through selected folder path: `Shell.quote` single-quotes non-safe strings and escapes single quotes; direct mode uses `Process.arguments`, not shell parsing.
- [investigated] `.lazygit` package content execution: package contents are ignored; cwd is the package parent.

### 3. Simplicity (Stability)
- Add a random ttyd `--base-path` as a URL capability rather than reintroducing Basic Auth, because ttyd's frontend WebSocket cannot attach custom Basic Auth headers.
- Redact the base path in app logs while still logging enough command structure for diagnostics.
- Restore `--once` alongside `--max-clients 1` to prevent reconnect-loop process spawning.
- Centralize environment filtering in `RunnerEnvironmentBuilder` with explicit blocked keys/prefixes.

### 4. Reversibility (Safety)
- Changes are local to `source/LazyGit`.
- Tests cover command construction, URL/path validation, redaction, and environment filtering.
- UI smoke now creates a temporary Git repo fixture so `--once` is tested against a live lazygit process instead of an expected non-repo exit.
