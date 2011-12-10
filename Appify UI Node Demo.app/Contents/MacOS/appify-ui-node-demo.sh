#!/usr/bin/env bash -l

cd "$(dirname "$0")"

if [ ! `which -s node` ]; then
    # launch the node app
    ./app.node.js "$@"
else
    echo "Node.js cannot be found" 1>&2
    open "http://nodejs.org/#download"
    exit 1
fi
