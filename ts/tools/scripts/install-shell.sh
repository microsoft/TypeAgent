#!/bin/bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# Download a blob by name into $DEST. Uses an anonymous HTTPS base URL
# (SHELL_BASE_URL) when set, otherwise the Azure CLI with 'az login'.
function download_blob() {
    local name="$1"
    if [[ -n "$BASE_URL" ]]; then
        local url="${BASE_URL%/}/$name"
        info "Downloading $url"
        if command -v curl >/dev/null 2>&1; then
            curl -fsSL "$url" -o "$DEST/$name" > $DEST/install-shell.log 2>&1
        elif command -v wget >/dev/null 2>&1; then
            wget -q "$url" -O "$DEST/$name" > $DEST/install-shell.log 2>&1
        else
            error "Neither curl nor wget is available to download $url"
            return 1
        fi
        if [[ $? != 0 ]]; then
            error "Failed to download $url"
            cat $DEST/install-shell.log
            return 1
        fi
        return 0
    fi

    info "Downloading $name"
    az storage blob download --account-name $STORAGE --container-name $CONTAINER --name "$name" --file "$DEST/$name" --overwrite --auth-mode login > $DEST/install-shell.log 2>&1
    if [[ $? != 0 ]]; then
        error "Failed to download $name from $STORAGE/$CONTAINER."
        error "Ensure you that you are logged into azure cli with 'az login' and have access to the storage account."
        cat $DEST/install-shell.log
        return 1
    fi
    return 0
}

function download_yml() {
    download_blob "$1"
}

function download_package() {
    download_blob "$1"
}

function install_package_linux() {
    info "Installing $1"
    sudo apt install -y "$DEST/$1" > $DEST/install-shell.log 2>&1
    if [[ $? != 0 ]]; then
        error "Failed to install $1"
        cat $DEST/install-shell.log    
        return 1
    fi
    typeagentshell
    success "$1 installed successfully."
    success "TypeAgent Shell will start automatically."

}

function install_package_mac() {
    info "Installing $1"
    unzip -o "$DEST/$1" -d "/Applications" > $DEST/install-shell.log 2>&1
    if [[ $? != 0 ]]; then
        error "Failed to install $1"
        cat $DEST/install-shell.log    
        return 1
    fi
    open /Applications/TypeAgent\ Shell.app
    success "$1 installed successfully."
    success "TypeAgent Shell will start automatically."
    return 0
}

function usage() {
    echo Usage: $0 \<storage\> \[\<container\>\] \[\<channel\>\]
    echo \ \ \<storage\>\ \ \ - The name of the storage account to use.
    echo \ \ \<container\> - The name of the container to use. \<storage\> will be used if not specified.
    echo \ \ \<channel\>\ \ \ - The channel to use. Default to 'lkg' if not specified.
    echo
    echo Environment variables:
    echo \ \ SHELL_BASE_URL - Anonymous HTTPS base for a public container, e.g.
    echo \ \ \ \ https://\<account\>.blob.core.windows.net/\<container\>. When set,
    echo \ \ \ \ the Azure CLI is not used and \<storage\> is optional.
    echo \ \ SHELL_CHANNEL\ \ - Fallback channel when not passed positionally.
    echo \ \ SKIP_TYPEAGENT_CHECK - Set to 1 to skip ensuring the agent-server is
    echo \ \ \ \ installed before the shell \(e.g. when it runs on another machine\).
    echo \ \ TYPEAGENT_ARGS - Extra args passed to install-typeagent.sh when the
    echo \ \ \ \ agent-server is missing and gets installed automatically.
}

function info() {
    echo [30m[90mINFO: $*[0m
}

function success() {
    echo [30m[92mSUCCESS: $*[0m
}

function error() (
    echo [30m[91mERROR: $*[0m
)

function cleanup() {
    info "Cleaning up..."
    rm -rf $DEST > /dev/null 2>&1
 
}

BASE_URL="${SHELL_BASE_URL:-}"

if [[ "$1" == "" && -z "$BASE_URL" ]]; then
    error No storage account specified.
    usage
    exit 1
fi

STORAGE=$1
if [[ "$2" == "" ]]; then
    CONTAINER=$1
else
    CONTAINER=$2
fi

if [[ "$3" == "" ]]; then
    CHANNEL="${SHELL_CHANNEL:-lkg}"
else
    CHANNEL=$3
fi

ARCH=$(uname -m)
if [[ "$ARCH" == "x86_64" ]]; then
    ARCH=x64
elif [[ "$ARCH" == "arm64" ]]; then
    ARCH=arm64
else
    error "Unsupported architecture: $ARCH"
    exit 1
fi

CHANNEL=$CHANNEL-$ARCH

# The shipped shell is connect-only: it auto-spawns and connects to a separately
# installed TypeAgent agent-server. Ensure that server is installed first so the
# shell has something to connect to, mirroring the MSI ordering (agent service
# before shell). The agent-server install lays down typeagent-serve.mjs at its
# InstallDir root (see install-typeagent.sh). Set SKIP_TYPEAGENT_CHECK=1 to
# bypass (e.g. when the server lives on another machine reached via a tunnel).
if [[ "${SKIP_TYPEAGENT_CHECK:-}" != "1" ]]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        AGENT_SERVER_DIR="$HOME/Library/Application Support/TypeAgent/agent-server"
    else
        AGENT_SERVER_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/typeagent/agent-server"
    fi
    AGENT_SERVER_MARKER="$AGENT_SERVER_DIR/typeagent-serve.mjs"
    if [[ -f "$AGENT_SERVER_MARKER" ]]; then
        info "Found TypeAgent agent-server at $AGENT_SERVER_MARKER."
    else
        info "TypeAgent agent-server not found at $AGENT_SERVER_MARKER; installing it first via install-typeagent.sh."
        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        INSTALL_TYPEAGENT="$SCRIPT_DIR/install-typeagent.sh"
        if [[ ! -f "$INSTALL_TYPEAGENT" ]]; then
            error "Cannot find install-typeagent.sh next to install-shell.sh to satisfy the agent-server dependency. Set SKIP_TYPEAGENT_CHECK=1 to bypass."
            exit 1
        fi
        bash "$INSTALL_TYPEAGENT" ${TYPEAGENT_ARGS:-}
        if [[ $? != 0 ]]; then
            error "Agent-server install (install-typeagent.sh) failed; aborting shell install."
            exit 1
        fi
        if [[ ! -f "$AGENT_SERVER_MARKER" ]]; then
            error "install-typeagent.sh completed but agent-server marker still missing at $AGENT_SERVER_MARKER."
            exit 1
        fi
        success "TypeAgent agent-server installed."
    fi
fi

DEST=/tmp/install-shell
cleanup
mkdir -p $DEST > /dev/null 2>&1
if [[ $? != 0 ]]; then
    error "Failed to create $DEST directory."
    exit 1
fi

if [[ $? != 0 ]]; then
    error "Failed to delete files in $DEST directory."
    exit 1
fi

if [[ "$OSTYPE" == "darwin"* ]]; then
    # Mac OSX
    YML=$CHANNEL-mac.yml
else 
    # Linux
    YML=$CHANNEL-linux.yml
fi

if [[ -n "$BASE_URL" ]]; then
    SOURCE_DESC=$BASE_URL
else
    SOURCE_DESC=$STORAGE/$CONTAINER
fi

info "Getting TypeAgent Shell from [30m[96m$CHANNEL[0m channel in [30m[93m$SOURCE_DESC[0m."
download_yml $YML
if [[ $? != 0 ]]; then 
    cleanup
    exit 1
fi

PACKAGE=$(cat $DEST/$YML | grep -i path | cut -d ':' -f 2)
PACKAGE=${PACKAGE#"${PACKAGE%%[![:space:]]*}"}
if [[ "$PACKAGE" == "" ]]; then
    error "Failed to find path in $YML.  Ensure that the file is valid."
    cleanup
    exit 1
fi

download_package "$PACKAGE"
if [[ $? != 0 ]]; then  
    cleanup
    exit 1
fi

if [[ "$OSTYPE" == "darwin"* ]]; then
    # Mac OSX
    install_package_mac "$PACKAGE"
else
    install_package_linux "$PACKAGE"
fi
if [[ $? != 0 ]]; then
    cleanup
    exit 1
fi

cleanup
