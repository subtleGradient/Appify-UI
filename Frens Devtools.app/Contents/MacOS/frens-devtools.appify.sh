#!/usr/bin/env bash
cd "$(dirname "$0")/../.."
APP_ROOT="$PWD"

export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

"$APP_ROOT/Contents/src/frens-devtools.appify.bun.ts" >"${APP_ROOT}.log" 2>&1
