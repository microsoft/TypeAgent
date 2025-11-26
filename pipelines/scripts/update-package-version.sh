# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

jq ".version=\"$1\"" package.json > package.tmp.json && mv package.tmp.json package.json