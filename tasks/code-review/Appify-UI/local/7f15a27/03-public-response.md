# Public Response

## Summary
This commit removes WebFormer's visible web Save button, adds autosave/native save hooks to the injected runtime, and wires AppifyHost Save/Save As/close checks through `window.AppifyHost`.

## Good
- The UI direction is right: no persistent web Save button, one runtime save path, and transient status only.
- The save hook awaits the browser-side POST and returns structured failure to AppKit.
- The close path now consults `window.AppifyHost.isDirty()`, which protects the immediate edit-then-close case once the host code is actually running.

## Blockers
- The root `WebFormer.app` bundle still appears to run stale AppifyHost code. `WebFormer.app/Contents/Info.plist` launches `Contents/MacOS/appify-host`, while the embedded `WebFormer.app/Contents/Resources/AppifyHostSource/Sources/appify-host/AppifyHostDocument.swift` lacks the new save overrides. The commit only changes shared `source/AppifyHost`, so double-clicking or distributing this app bundle can still miss the native Save integration.
- `Save As...` flushes pending web edits to the original document before running `super.saveAs`. The new `saveAs(_:)` path calls `flushWebDocumentBeforeNativeSave`, which triggers WebFormer `/api/save`; that endpoint writes the current opened file, not the future Save As destination. This makes Save As mutate the source document as a side effect.

## Verdict
REQUEST CHANGES
