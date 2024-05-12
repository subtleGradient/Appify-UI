#!/usr/bin/env bash

App="$(dirname "$0")/../.."
cd "$App"
App="$PWD"

bunNotFound() {
  echo "bun not found. Show error" >&2
  URL="file://$App/Contents/Resources/Bun not found Error.html"
  URL="${URL// /%20}"
  "$App/Contents/MacOS/Appify UI 23.app/Contents/MacOS/Appify UI 23" --url "${URL}"
  exit 1
}

installBun() {
  echo "Installing bun..." >&2
  curl -fsSL https://bun.sh/install | bash
}

bun_run() {
  local bun="$App/Contents/MacOS/bun"         # for packaging bun with the app
  [[ -f "$bun" ]] || bun="$HOME/.bun/bin/bun" # default install location
  [[ -f "$bun" ]] || bun="$(which bun)"       # in PATH
  [[ -f "$bun" ]] || installBun               # install bun if not found
  [[ -f "$bun" ]] || bun="$HOME/.bun/bin/bun" # default install location?!
  [[ -f "$bun" ]] || bun="$(which bun)"       # in PATH?!
  [[ -f "$bun" ]] || bunNotFound              # give up :(

  "$bun" run "$@"
}

main() {
  MAIN="$App/Contents/app/main.ts"
  bun_run "$MAIN" "$@"
}

main "$@" >"$App.$$.log" 2>&1
