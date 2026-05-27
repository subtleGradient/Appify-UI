# Web Runner Source

This folder is the app-specific source for `Web.app`.

The Bun runner serves `.web` packages and `.web` marker files as static,
browser-native folders. It adds live reload where possible and renders Markdown
files as a convenience without making build tooling part of the `.web` package
contract.

## Hack On It

1. Run `bun test tests/*.test.ts` from this folder.
2. Edit `src/index.ts` or `src/webPackage.ts`.
3. Reopen the package or use View > Reload after runtime changes.

## Clone Into A New App

Copy `Web.app`, rename the bundle, update `Contents/Info.plist`, and tailor the
runner to the static package shape you want. Keep the ready line:
`APPIFY_HOST_OPEN_URL=`.

Credits: Bun serves the local package.
