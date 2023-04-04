#!/usr/bin/env bash

App="$(dirname "$0")/../.."
cd "$App";App="$PWD"

function denoNotFound () {
  URL="file://$App/Contents/Resources/Deno not found Error.html"
  URL="${URL// /%20}"
  "$App/Contents/MacOS/appify-ui-webview" -url "${URL}"
  exit 1
}

function installDeno () {
  curl -fsSL https://deno.land/x/install/install.sh | sh
}

deno="$App/Contents/MacOS/deno"                 # for packaging deno with the app
[[ -f "$deno" ]] || deno="$HOME/.deno/bin/deno" # default install location
[[ -f "$deno" ]] || deno="`which deno`"         # in PATH
[[ -f "$deno" ]] || installDeno
[[ -f "$deno" ]] || deno="$HOME/.deno/bin/deno" # default install location
[[ -f "$deno" ]] || deno="`which deno`"         # in PATH
[[ -f "$deno" ]] || denoNotFound

# MAIN="$App/Contents/Resources/app/main.ts"
MAIN="$App/Contents/Resources/app/lib/http-webview.ts"

"$deno" run --allow-read --allow-write --allow-net --allow-env --allow-run "$MAIN" "$@"
