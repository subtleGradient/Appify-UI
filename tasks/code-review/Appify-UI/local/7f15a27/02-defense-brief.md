# Defense Brief

## Issue: Shipped WebFormer.app may still run stale host code
- **My Claim:** The source commit does not update the actual root `WebFormer.app` host executable or embedded host source, so double-clicking the app can miss the native save hook.
- **Defense Hypothesis:** Maybe `Contents/MacOS/main.sh` rebuilds from `source/AppifyHost` on launch, so committing only shared source is enough.
- **Evidence Search:** `WebFormer.app/Contents/Info.plist` sets `CFBundleExecutable` to `appify-host`, not `main.sh`. The embedded `WebFormer.app/Contents/Resources/AppifyHostSource/Sources/appify-host/AppifyHostDocument.swift` still has no `save(_:)` or `saveAs(_:)` override. `git diff --name-only 1d02e1d..7f15a27` does not include the embedded host source, binary, or hash files.
- **Verdict:** `survives`

## Issue: Save As mutates the original file
- **My Claim:** Save As now writes pending web edits to the current source document before the user chooses/saves the copy.
- **Defense Hypothesis:** AppKit Save As may intentionally save the current document first, or WebFormer autosave means the original would already be saved anyway.
- **Evidence Search:** `AppifyHostDocument.saveAs(_:)` calls `flushWebDocumentBeforeNativeSave`, the web hook POSTs to `/api/save`, and `handleSave` writes to the current `documentPath` before `super.saveAs` runs. Autosave makes this less surprising when the debounce has already fired, but Command-S/Save As during a pending debounce still forces the original file mutation as part of Save As.
- **Verdict:** `survives`

## Issue: Dirty-state hook errors are treated as clean
- **My Claim:** If `window.AppifyHost.isDirty()` throws, close validation allows close.
- **Defense Hypothesis:** The WebFormer `isDirty` implementation is trivial and should not throw.
- **Evidence Search:** The hook itself is `dirtyVersion!==savedVersion||savePromise!==null`, so the immediate WebFormer risk is low. The generic host behavior still contradicts the stated pit-of-success/zero-silent-errors requirement, but this commit does not rely on a complex hook.
- **Verdict:** `downgraded`
