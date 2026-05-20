# LazyGit.app

Standalone macOS document package app for opening `lazygit` in a locked-down `WKWebView` terminal.

Build and test:

```sh
swift test
Scripts/build-app.sh
```

The app bundle is emitted at `dist/LazyGit.app` and declares `.lazygit` as a Finder package. A `.lazygit` package is only a marker folder; LazyGit runs in the package's parent directory.

Release packaging:

```sh
DEVELOPER_ID_APPLICATION="Developer ID Application: Example, Inc. (TEAMID)" \
NOTARYTOOL_PROFILE="notarytool-profile-name" \
Scripts/package-release.sh 0.1.0
```

The release script signs with Developer ID hardened runtime, submits the app zip for Apple notarization, staples the ticket, validates with `spctl`, and emits `dist/release/LazyGit.app.zip`. It intentionally fails if Developer ID signing or notarization credentials are not available.

For this project, double-click `Scripts/sign-and-notarize.command` to run the signed/notarized release flow. It uses Apple ID `eng.aop@gmail.com`, Team ID `343ZZ763EA`, and stores/uses the `subtlegradient-notary` notarization profile.
