# LazyGit.app

Concrete `AppifyHost` package for opening `lazygit` in a locked-down
non-persistent `WKWebView` terminal.

`LazyGit.app` declares `.lazygit` as a Finder package. A `.lazygit` package is
only a marker folder; LazyGit runs in the package's parent directory.

Build and test:

```sh
cd ../AppifyHost
swift test

cd ../LazyGit
Scripts/build-app.sh
Scripts/smoke-ui.sh
```

The release-style development app bundle is emitted at `dist/LazyGit.app`.

Refresh the checked-in root developer bundle:

```sh
Scripts/build-root-app.sh
```

That writes `../../LazyGit.app` without signing it. The dist app remains
ad-hoc signed by default so the existing UI smoke path can verify its bundle
signature.

Release packaging:

```sh
DEVELOPER_ID_APPLICATION="Developer ID Application: Example, Inc. (TEAMID)" \
NOTARYTOOL_PROFILE="notarytool-profile-name" \
Scripts/package-release.sh 0.1.0
```

The release script signs with Developer ID hardened runtime, submits the app zip
for Apple notarization, staples the ticket, validates with `spctl`, and emits
`dist/release/LazyGit.app.zip`. It intentionally fails if Developer ID signing
or notarization credentials are not available.

For this project, double-click `Scripts/sign-and-notarize.command` to run the
signed/notarized release flow. It uses Apple ID `eng.aop@gmail.com`, Team ID
`343ZZ763EA`, and stores/uses the `subtlegradient-notary` notarization profile.
