#!/usr/bin/env bash
cd "$(dirname "$0")"

# launch the cocoa app
./apache-callback-mac -url "file://$(dirname "$0")/../Resources/index.html"
