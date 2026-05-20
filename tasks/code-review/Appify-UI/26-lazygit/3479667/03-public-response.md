# Public Response

## Summary
Reviewed the standalone `source/LazyGit` app for security attack surfaces around `.lazygit` package opening, ttyd exposure, process launching, logging, and inherited environment.

## Good
- `.lazygit` package contents are not executed; the app only uses the package parent as the lazygit working directory.
- Direct mode uses `Process.arguments`; Nix mode uses a quoting helper for the single `--run` string.
- WKWebView uses a non-persistent data store and native navigation policy checks.

## Closed Attack Surfaces
- Added a random ttyd `--base-path` capability and restricted WKWebView navigation to `http://127.0.0.1:<port>/<base-path>/...`.
- Redacted the generated base path from both runner-command logs and ttyd output logs.
- Restored `ttyd --once` while keeping `--max-clients 1`, reducing reconnect-loop process spawning.
- Added `RunnerEnvironmentBuilder` to strip shell startup hooks and dynamic-loader env vars before launching `nix-shell` or direct `ttyd`.
- Updated smoke coverage to use a temporary Git repo so the hardened `--once` behavior is tested against a live lazygit session.

## Verdict
`APPROVE` after the hardening patch. Remaining risk is inherent to running a Git UI in a user-chosen repository: repository-local Git configuration and lazygit behavior still execute in the user's context when the user opens that folder.
