# Webapp Runner Source

This folder is the app-specific source for `Webapp.app`.

The Bun runner opens `.webapp` package folders, scaffolds minimal package
metadata when needed, runs `bun install`, starts `bun dev`, and loads the first
loopback URL printed by the dev process.

## Hack On It

1. Run `bun test tests/*.test.ts` from this folder.
2. Edit `src/index.ts` or `src/webappPackage.ts`.
3. Reopen the package or use View > Reload after runtime changes.

## Clone Into A New App

Copy `Webapp.app`, rename the bundle, update `Contents/Info.plist`, and specialize
the runner around a framework, template, or dev command. Keep stdout producing a
ready URL for the shared host.

Credits: Bun provides package install and dev-server execution.
