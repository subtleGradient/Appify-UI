#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${LAZYGIT_SMOKE_APP:-$ROOT/dist/LazyGit.app}"
EXPECTED_BUNDLE_IDENTIFIER="com.subtlegradient.LazyGit"
LOG_DIR="$HOME/Library/Logs/LazyGit"
DIAGNOSTIC_REPORT_DIR="$HOME/Library/Logs/DiagnosticReports"
SMOKE_SKIP_BUILD="${LAZYGIT_SMOKE_SKIP_BUILD:-}"
REQUIRE_SIGNATURE="${LAZYGIT_SMOKE_REQUIRE_SIGNATURE:-1}"
STAMP_FILE="$(mktemp "${TMPDIR:-/tmp}/lazygit-app-smoke.XXXXXX")"
SMOKE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/lazygit-app-fixture.XXXXXX")"
SMOKE_REPO="$SMOKE_ROOT/Sample Folder"
DOCUMENT="$SMOKE_REPO/sample-folder.lazygit"

cleanup() {
  rm -f "$STAMP_FILE"
  rm -rf "$SMOKE_ROOT"
}
trap cleanup EXIT

mkdir -p "$DOCUMENT"
git init -q "$SMOKE_REPO"

if [[ -z "$SMOKE_SKIP_BUILD" ]]; then
  if [[ -n "${LAZYGIT_SMOKE_APP:-}" ]]; then
    SMOKE_SKIP_BUILD=1
  else
    SMOKE_SKIP_BUILD=0
  fi
fi

if [[ "$SMOKE_SKIP_BUILD" != "1" ]]; then
  "$ROOT/Scripts/build-app.sh" >/dev/null
fi

if [[ ! -x "$APP/Contents/MacOS/main.sh" || ! -x "$APP/Contents/MacOS/tui-host" ]]; then
  echo "Missing executable app bundle at $APP" >&2
  exit 1
fi

if [[ "$REQUIRE_SIGNATURE" == "1" ]]; then
  codesign -vvv --deep --strict "$APP" >/dev/null
fi

status=0
"$ROOT/Scripts/smoke-ui.jxa.js" "$APP" "$EXPECTED_BUNDLE_IDENTIFIER" "$DOCUMENT" || status=$?

declare -a new_logs=()
if [[ -d "$LOG_DIR" ]]; then
  while IFS= read -r log_path; do
    new_logs+=("$log_path")
  done < <(find "$LOG_DIR" -type f -name "*.log" -newer "$STAMP_FILE" -print | sort)
fi

for log_path in "${new_logs[@]}"; do
  echo "== LazyGit.app log: $log_path =="
  sed -n "1,220p" "$log_path"
done

declare -a new_crash_reports=()
if [[ -d "$DIAGNOSTIC_REPORT_DIR" ]]; then
  while IFS= read -r report_path; do
    new_crash_reports+=("$report_path")
  done < <(find "$DIAGNOSTIC_REPORT_DIR" -type f -name "LazyGit-*.ips" -newer "$STAMP_FILE" -print | sort)
fi

if [[ ${#new_crash_reports[@]} -gt 0 ]]; then
  status=1
  for report_path in "${new_crash_reports[@]}"; do
    echo "== LazyGit.app crash report: $report_path =="
    sed -n "1,180p" "$report_path"
  done
fi

exit "$status"
