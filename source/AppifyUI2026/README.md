# Appify UI 2026

Fresh SwiftPM implementation of Appify UI as a `.webapp` document launcher.

Build the command-line Swift target:

```sh
swift build
```

Run tests:

```sh
swift test
```

Build the macOS app bundle:

```sh
Scripts/build-app.sh
```

The bundle is emitted at `dist/Appify UI.app` and declares `.webapp` as a macOS document package. A `.webapp` folder must contain lowercase `webapp.toml` and a runner package pinned to a full commit SHA under `github:subtleGradient`.
