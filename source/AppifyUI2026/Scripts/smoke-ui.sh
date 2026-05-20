#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/dist/Appify UI.app"
EXPECTED_BUNDLE_IDENTIFIER="com.subtlegradient.AppifyUI2026"
DOCUMENT="$ROOT/Fixtures/Hello.webapp"
LOG_DIR="$HOME/Library/Logs/Appify-UI"
DIAGNOSTIC_REPORT_DIR="$HOME/Library/Logs/DiagnosticReports"
STAMP_FILE="$(mktemp "${TMPDIR:-/tmp}/appify-ui-smoke.XXXXXX")"

if [[ "${APPIFY_SMOKE_SKIP_BUILD:-0}" != "1" ]]; then
  "$ROOT/Scripts/build-app.sh" >/dev/null
fi

if [[ ! -x "$APP/Contents/MacOS/Appify UI" ]]; then
  echo "Missing executable app bundle at $APP" >&2
  exit 1
fi

codesign -vvv --deep --strict "$APP" >/dev/null

status=0
"$ROOT/Scripts/smoke-ui.jxa.js" "$APP" "$EXPECTED_BUNDLE_IDENTIFIER" "$DOCUMENT" || status=$?

new_logs=()
if [[ -d "$LOG_DIR" ]]; then
  while IFS= read -r log_path; do
    new_logs+=("$log_path")
  done < <(find "$LOG_DIR" -type f -name "*.log" -newer "$STAMP_FILE" -print | sort)
fi

for log_path in "${new_logs[@]}"; do
  echo "== Appify UI log: $log_path =="
  sed -n "1,220p" "$log_path"
done

new_crash_reports=()
if [[ -d "$DIAGNOSTIC_REPORT_DIR" ]]; then
  while IFS= read -r report_path; do
    new_crash_reports+=("$report_path")
  done < <(find "$DIAGNOSTIC_REPORT_DIR" -type f -name "Appify UI-*.ips" -newer "$STAMP_FILE" -print | sort)
fi

if [[ ${#new_crash_reports[@]} -gt 0 ]]; then
  status=1
  for report_path in "${new_crash_reports[@]}"; do
    echo "== Appify UI crash report: $report_path =="
    sed -n "1,180p" "$report_path"
  done
fi

rm -f "$STAMP_FILE"
exit "$status"
