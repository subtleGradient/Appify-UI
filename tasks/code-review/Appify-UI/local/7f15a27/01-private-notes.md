## Code Review Log - local review

### 1. Incentive (Hypothesis)
- Claim: This change solves a real problem: WebFormer should not rely on a custom web Save button, and macOS Save/close affordances should flush webform edits.
- Evidence: `WebFormer.app/Contents/Resources/Runner/src/webform.ts` removes `#__webformer_save`, adds autosave and `window.AppifyHost.save()/isDirty()`. `source/AppifyHost/Sources/appify-host/AppifyHostDocument.swift` overrides `save(_:)` and `saveAs(_:)`.

### 2. Adversarial Attack (Falsification)
- [blocker] Shipped app bundle may still run stale host code. The commit updates `source/AppifyHost/...`, but `WebFormer.app/Contents/Info.plist` launches `Contents/MacOS/appify-host`, and the embedded `WebFormer.app/Contents/Resources/AppifyHostSource/.../AppifyHostDocument.swift` lacks the new save overrides. The diff did not include the app binary, embedded AppifyHost source, or source hash files.
- [blocker] Save As mutates the original file before the destination is chosen. `saveAs(_:)` calls `flushWebDocumentBeforeNativeSave`, which calls the web hook. WebFormer's save hook POSTs to `/api/save`, and `src/index.ts` writes `result.source` to the currently opened `documentPath`. Then `super.saveAs` runs. That means Save As first saves the source document, then copies/saves to a new path.
- [risky] Close dirty-state errors are treated as clean. The new `window.AppifyHost.isDirty()` call is inside one `evaluateJavaScript` block; if it throws, the error branch completes with `dirty: false`. For WebFormer's current hook this is unlikely, but the behavior is opposite of zero-silent-error save semantics.

### 3. Simplicity (Stability)
- Good: The user-facing Save button was removed, and the browser runtime has one persistence path (`save(null)`) used by autosave, submit interception, Command-S, and AppifyHost.
- Risk: AppKit Save and WebFormer save now both write. For plain Save this is mostly redundant, but Save As makes the order observable and wrong.

### 4. Reversibility (Safety)
- Reversible: Runtime injection changes are isolated to WebFormer runner.
- Less reversible: AppifyHost source changes affect every hosted app once the shared host binary is rebuilt.
