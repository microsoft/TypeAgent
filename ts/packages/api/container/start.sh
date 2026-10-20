#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
    echo "[agent-api] Refusing to run as root." >&2
    exit 70
fi

if [[ -d "${HOME:?HOME must be set}/.azure" ]]; then
    echo "[agent-api] Refusing to start with persistent Azure CLI state." >&2
    exit 78
fi

exec node ./dist/index.js
