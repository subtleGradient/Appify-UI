#!/usr/bin/env bash

App="$(dirname "$0")/../.."
cd "$App";App="$PWD"

function NodeNotFound () {
  URL="file://$App/Contents/Resources/Node not found Error.html"
  URL="${URL// /%20}"
  "$App/Contents/MacOS/appify-ui-webview" -url "${URL}"
  exit 1
}

Node="$App/Contents/MacOS/node"
[[ -f "$Node" ]] || Node="`which node`"
[[ -f "$Node" ]] || Node="/usr/local/bin/node"
[[ -f "$Node" ]] || NodeNotFound

"$Node" "$App/Contents/Resources/app/main.js" "$@"
