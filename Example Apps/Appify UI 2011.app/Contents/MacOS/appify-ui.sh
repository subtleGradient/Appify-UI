#!/usr/bin/env bash
# 
# MIT License
# 
# Created By
#   Thomas Aylott <http://subtlegradient.com>
# 
# Special Thanks
#   Mathias Bynens <http://mathiasbynens.be>
#   Shazron Abdullah <http://www.shazron.com>
#   Apache Callback Mac (heavily modified) <https://github.com/subtleGradient/callback-mac>
#   Marc Wäckerlin <http://marc.waeckerlin.org/computer/blog/parsing_of_query_string_in_bash_cgi_scripts>


# Decodes an URL-string
# an URL encoding has "+" instead of spaces
# and no special characters but "%HEX"
function urlDec() {
    local value=${*//+/%20}                   # replace +-spaces by %20 (hex)
    for part in ${value//%/ \\x}; do          # split at % prepend \x for printf
        printf "%b%s" "${part:0:4}" "${part:4}" # output decoded char
    done
}

# For all given query strings
# parse them an set shell variables
function setQueryVars() {
    local vars="$(cat)"
    local vars="${vars//\*/%2A}"                 # escape * as %2A
    for var in ${vars//&/ }; do                  # split at &
        local value=$(urlDec "${var#*=}")          # decode value after =
        value=${value//\\/\\\\}                    # change \ to \\ for later
        eval "CGI_${var%=*}=\"${value//\"/\\\"}\"" # evaluate assignment
    done
}

function handleForm () {
    appify
}

function appify () {
    setQueryVars

    cd "$HOME/Desktop"

    # Options
    local appify_FILE="$CGI_CFBundleExecutable"
    local appify_NAME="$CGI_CFBundleName"
    local appify_ROOT="$appify_NAME.appify/Contents/MacOS"
    local appify_INFO="$appify_ROOT/../Info.plist"

    if [[ "$appify_FILE" == "" ]]; then
        echo "CFBundleExecutable is required. Aborting" 1>&2
        exit 1
    fi

    # Create the bundle
    if [[ -a "$appify_NAME.appify" ]]; then
        echo "$PWD/$appify_NAME.appify already exists :(" 1>&2
        exit 1
    fi
    mkdir -p "$appify_ROOT"


    # Create a new blank CFBundleExecutable
    cat <<-EOF > "$appify_ROOT/$appify_FILE"
#!/usr/bin/env bash
# launch the cocoa app
cd "\$(dirname "\$0")"
./apache-callback-mac -url "file://\$(dirname "\$0")/../Resources/index.html"
EOF
    echo "Created blank '$appify_ROOT/$appify_FILE' be sure to edit this file to make it do things and stuff" 1>&2

    chmod +x "$appify_ROOT/$appify_FILE"

    cp "$(dirname "$0")/apache-callback-mac" "$appify_ROOT/"
    mkdir -p "$appify_ROOT/../Resources/English.lproj"
    cp "$(dirname "$0")/../Resources/English.lproj/MainMenu.nib" "$appify_ROOT/../Resources/English.lproj/MainMenu.nib"
    cat <<-EOF > "$appify_ROOT/../Resources/index.html"
<!doctype html>
<meta charset=utf-8>
<title>$appify_NAME</title>
<style>html{font-family:"Lucida Grande"; font-size:12px; border-top:1px solid #8A8A8A; background:#E8E8E8;}</style>
$appify_NAME
EOF

    # Create the Info.plist
    cat <<-EOF > "$appify_INFO"
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleInfoDictionaryVersion</key><string>6.0</string>

    <key>CFBundleIconFile</key>           <string>$CGI_CFBundleIconFile</string>

    <key>CFBundleName</key>               <string>$CGI_CFBundleName</string>
    <key>CFBundleExecutable</key>         <string>$CGI_CFBundleExecutable</string>
    <key>CFBundleIdentifier</key>         <string>$CGI_CFBundleIdentifier</string>

    <key>CFBundleVersion</key>            <string>$CGI_CFBundleVersion</string>
    <key>NSHumanReadableCopyright</key>   <string>$CGI_NSHumanReadableCopyright</string>
    <key>CFBundleShortVersionString</key> <string>$CGI_CFBundleShortVersionString</string>

    <!-- Needed for Apache Callback -->
    <key>NSPrincipalClass</key><string>NSApplication</string>
    <key>NSMainNibFile</key><string>MainMenu</string>

</dict></plist>
EOF

    # Appify!
    if [[ -a "$appify_NAME.app" ]]; then
        echo "$appify_NAME.app already exists :(" 1>&2
        exit 1
    fi
    mv "$appify_NAME.appify" "$appify_NAME.app"
    
    exit
}

function waitForFormData () {
    cat <<EOF\
        | nc -l 9999\
        | head -1\
        | cut -d' ' -f2\
        | cut -d'?' -f2
HTTP/1.0 200 OK
Content-Type: text/html

Appified on `date`
EOF
}


# async HTTP server
waitForFormData | handleForm &

# launch the cocoa app
cd "$(dirname "$0")"
./apache-callback-mac

# close nc just in case
nc localhost 9999 > /dev/null
