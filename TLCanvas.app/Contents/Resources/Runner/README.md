# TLCanvas Runner Source

This folder is the canonical app-specific source for `TLCanvas.app`.

The Bun runner hosts a tldraw-based editor, persists `.tlcanvas` package data,
and carries schema, tests, source, lockfile, and installed dependencies needed
for local development.

## Hack On It

1. Run `bun install --frozen-lockfile` when dependencies need refreshing.
2. Run `bun test tests/*.test.ts`.
3. Edit `src/App.tsx`, `src/canvasApi.ts`, or nearby files.
4. Reopen the document or use View > Reload after runtime changes.

## Clone Into A New App

Copy `TLCanvas.app`, rename the bundle, update `Contents/Info.plist`, and adjust
the runner for the drawing/document variant you want. Keep the server ready
signal as `APPIFY_HOST_OPEN_URL=`.

Credits: tldraw provides the drawing SDK and UI foundation.
