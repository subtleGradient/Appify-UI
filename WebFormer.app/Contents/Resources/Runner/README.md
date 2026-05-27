# WebFormer Runner Source

This folder is the app-specific source for `WebFormer.app`.

The Bun runner serves single-file `.webform` HTML documents, injects save
affordances with `HTMLRewriter`, and writes edited native form state back into
the same source file with narrow patches.

## Hack On It

1. Run `bun test tests/*.test.ts` from this folder.
2. Edit `src/index.ts` or `src/webform.ts`.
3. Reopen the `.webform` file or use View > Reload after runtime changes.

## Clone Into A New App

Copy `WebFormer.app`, rename the bundle, update `Contents/Info.plist`, and tune
the runner for the single-file document workflow you want. Preserve the
`APPIFY_HOST_OPEN_URL=` ready signal.

Credits: Bun runs the app server and HTMLRewriter performs source-aware edits.
