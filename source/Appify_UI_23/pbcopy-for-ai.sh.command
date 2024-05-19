#!/bin/bash
cd "$(dirname "$0")"
combine_files_to_markdown.ts *.swift **/*.swift *.plist | pbcopy
echo "Copied to clipboard"
