#!/usr/bin/env bash
# launch the cocoa app
cd "$(dirname "$0")"
./apache-callback-mac -url "file://$(dirname "$0")/../Resources/index.html"
