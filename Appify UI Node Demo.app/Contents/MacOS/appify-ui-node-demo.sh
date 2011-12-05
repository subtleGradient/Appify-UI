#!/usr/bin/env bash
cd "$(dirname "$0")"

# Check if node is installed
which node 1>&2

if [[ $? ]]; then
    # launch the node app
    ./app.node.js

else
    echo "Node.js cannot be found" 1>&2
    
    # Node is not installed. Tell them where to get it.
    ./apache-callback-mac
    
    exit 1
fi
