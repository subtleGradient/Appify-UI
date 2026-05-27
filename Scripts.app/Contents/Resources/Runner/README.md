# Scripts Runner Source

This folder is the app-specific source for `Scripts.app`.

The Bun runner discovers executable peer scripts around a `.scripts` marker
package, presents them in a local web UI, and launches selected commands through
terminal sessions.

## Hack On It

1. Run `bun test tests/*.test.ts` from this folder.
2. Edit `src/scriptCatalog.ts`, `src/terminalRunner.ts`, or `src/frontend.ts` to
   change discovery, execution, or UI behavior.
3. Reopen the `.scripts` package or use View > Reload after changes.

## Clone Into A New App

Copy `Scripts.app`, rename the bundle, update `Contents/Info.plist`, and tailor
the runner to a narrower command set. Keep command execution explicit: this app
is a local execution affordance, not a sandbox.

Credits: Bun runs the app server; ttyd backs terminal sessions.
