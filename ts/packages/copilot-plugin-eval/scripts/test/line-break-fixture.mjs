// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function replaceFirstLineBreak(value, replacement) {
    const index = value.indexOf("\n");
    return index === -1
        ? value
        : value.slice(0, index) + replacement + value.slice(index + 1);
}
