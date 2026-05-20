# LazyGit.app

Standalone macOS document package app for opening `lazygit` in a locked-down `WKWebView` terminal.

Build and test:

```sh
swift test
Scripts/build-app.sh
```

The app bundle is emitted at `dist/LazyGit.app` and declares `.lazygit` as a Finder package. A `.lazygit` package is only a marker folder; LazyGit runs in the package's parent directory.
