#!/usr/bin/env bash
cd "$(dirname "$0")"

# Check if node is installed
which node 1>&2 > /dev/null

if [[ $? ]]; then
    # launch the node app
    ./app.node.js "$@"

else
    echo "Node.js cannot be found" 1>&2
    open "http://nodejs.org/#download"
    exit 1
    
fi
