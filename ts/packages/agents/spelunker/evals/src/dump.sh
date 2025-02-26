#!/bin/bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

case $1 in
    "" | "-h" | "--help")
        echo "Usage: $0 <path>  # eval directory, e.g. evals/eval-1"
        exit 1
        ;;
esac

TABLES="Questions Scores"

sqlite3 $1/eval.db ".dump $TABLES" >$1/dbdump.sql  || exit 1
echo "Dumped $TABLES $1/eval.db to $1/dbdump.sql"

