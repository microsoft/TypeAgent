#!/bin/bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.


function download_yml() {
    info "Downloading $1"
    az storage blob download --account-name $STORAGE --container-name $CONTAINER --name $1 --file $DEST/$1 --overwrite --auth-mode login > $DEST/install-shell.log 2>&1
    if [[ $? != 0 ]]; then
        error "Failed to download $1 from $STORAGE/$CONTAINER"
        erorr "Ensure you that you are logged into azure cli with 'az login' and have access to the storage account."
        cat $DEST/install-shell.log    
        return 1
    fi
    return 0
}

function download_package() {
    info "Downloading $1"
    az storage blob download --account-name $STORAGE --container-name $CONTAINER --name "$1" --file "$DEST/$1" --overwrite --auth-mode login > $DEST/install-shell.log 2>&1
    if [[ $? != 0 ]]; then
        error "Failed to download $1 from $STORAGE/$CONTAINER."
        cat $DEST/install-shell.log
        return 1
    fi
    return 0
}

function install_package() {
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
    rm -rf $DEST > /dev/null 2>&1
}

if [[ "$1" == "" ]]; then
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
    CHANNEL=lkg
else
    CHANNEL=$3
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
    if [[ `uname -m` == "arm64" ]]; then
        # Mac OSX ARM64
        YML=$CHANNEL-mac-arm64.yml
    else
        # Mac OSX Intel
        YML=$CHANNEL-mac.yml
    fi
else 
    # Linux
    YML=$CHANNEL-linux.yml
fi

info "Getting TypeAgent Shell from [30m[96m$CHANNEL[0m channel in [30m[93m$STORAGE/$CONTAINER[0m."
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

install_package "$PACKAGE"
if [[ $? != 0 ]]; then
    cleanup
    exit 1
fi

cleanup
