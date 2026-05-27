# JSONCanvas Runner Source

This folder is the app-specific source for `JSONCanvas.app`.

The Bun runner serves the editor UI, validates JSON Canvas files, and writes the
opened `.canvas` document back as plain JSON. `src/index.ts` is the local server,
`src/frontend.ts` is the browser UI, and `tests/` covers the app-specific
document behavior.

## Hack On It

1. Run `bun test tests/*.test.ts` from this folder.
2. Edit files under `src/`.
3. Reopen a `.canvas` file or use View > Reload to pick up runtime changes.

## Clone Into A New App

Copy `JSONCanvas.app`, rename the bundle, change `Contents/Info.plist`, and keep
this runner as the source folder for the new document type. The shared host only
needs the runner to print `APPIFY_HOST_OPEN_URL=` when ready.

Credits: JSON Canvas defines the document format.
