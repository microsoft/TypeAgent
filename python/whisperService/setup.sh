# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# This file must be used with "source setup.sh" *from bash*
# you cannot run it directly

RECREATE=0

if [ "$1" = "--help" ]; then
    echo "Usage: setup [<directory>] [--recreate]"
    echo "Options:"
    echo "  <directory>: The directory where the virtual environment will be created. Default is ./.venv"
    echo "  --recreate: If specified, the virtual environment will be recreated if it already exists."
    return
fi

if [ "$1" = "--recreate" ]; then
    RECREATE=1
    shift
fi

if [ "$1" = "" ]; then 
    DIR=./.venv
else
    DIR=$1/.venv

    if [ "$2" = "--recreate" ]; then
        RECREATE=1        
    fi
fi


if [ $RECREATE = 1 ]; then
    if [ -d $DIR ]; then
        rm -rf $DIR
    fi
fi

if [ ! -f $DIR/bin/activate ]; then
    python3 -m venv $DIR
    source $DIR/bin/activate
    pip config --site set global.extra-index-url https://download.pytorch.org/whl/cu121
    pip install -r requirements.txt
else 
    source $DIR/bin/activate
fi


