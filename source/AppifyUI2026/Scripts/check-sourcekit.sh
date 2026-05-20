#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

swift test --package-path "$ROOT"

cd "$ROOT"
xcodebuild \
  -quiet \
  -scheme AppifyUI2026 \
  -destination "platform=macOS,arch=arm64" \
  -derivedDataPath "$ROOT/.build/xcode-derived" \
  build
