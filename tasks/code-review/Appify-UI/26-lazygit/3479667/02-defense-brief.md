# Defense Brief

## Issue: Localhost drive-by risk
- **My Claim:** Random port plus origin check is not enough defense-in-depth once ttyd Basic Auth is removed.
- **Defense Hypothesis:** A random loopback port may be sufficient for a local-only tool.
- **Evidence Search:** `TerminalURLValidator` previously allowed any path on the generated port; ttyd supports `--base-path`; smoke confirms endpoints move under the generated path.
- **Verdict:** `survives`. Closed by adding a random `/lazygit-<hex>` base path, loading only that URL, and rejecting navigation outside it.

## Issue: Logs leak command secrets
- **My Claim:** If a base-path token is added, raw command logging leaks it.
- **Defense Hypothesis:** Logs are local user files, so maybe acceptable.
- **Evidence Search:** `TerminalWindowController` writes command and ttyd output to `~/Library/Logs/LazyGit`; ttyd logs endpoint paths.
- **Verdict:** `survives`. Closed by redacting base path from command logging and ttyd output.

## Issue: Reconnect loop respawns crashing child command
- **My Claim:** `--max-clients 1` still lets ttyd accept a later reconnect and spawn lazygit again after a quick exit.
- **Defense Hypothesis:** This is mostly UX, not security.
- **Evidence Search:** Prior smoke logs showed repeated `WS /ws` and `started process` lines after lazygit exited in a non-repo fixture.
- **Verdict:** `survives` as DoS hardening. Closed by restoring `--once` and changing smoke to use a real temporary Git repo.

## Issue: Inherited shell/dynamic-loader environment
- **My Claim:** Passing all inherited environment into `nix-shell --run` leaves classic shell and loader hooks open.
- **Defense Hypothesis:** Finder-launched apps usually have a tame LaunchServices environment.
- **Evidence Search:** The code also supports `open -a`/CLI launched app sessions, and `ProcessInfo.processInfo.environment` was forwarded wholesale.
- **Verdict:** `survives`. Closed by stripping `BASH_ENV`, `ENV`, `ZDOTDIR`, `SHELLOPTS`, `CDPATH`, `IFS`, `DYLD_*`, and `LD_*`.

## Issue: Shell injection via selected path
- **My Claim:** A path with quotes/spaces/newlines might break `nix-shell --run`.
- **Defense Hypothesis:** `Shell.quote` correctly single-quotes unsafe strings, and direct mode uses argv arrays.
- **Evidence Search:** `Shell.quote` escapes single quotes; tests cover spaces in paths; no unquoted path is interpolated into the shell run command.
- **Verdict:** `downgraded`. No additional patch needed in this pass.
