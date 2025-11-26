// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Allow simple star regex, where * is the wildcard character
export function simpleStarRegex(m: string) {
    return new RegExp(
        `^${m.replaceAll(/([()\][{+.$^\\|?])/g, "\\$1").replaceAll("*", ".*")}$`,
    );
}
