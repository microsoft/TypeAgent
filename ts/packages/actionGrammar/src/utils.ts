// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function getLineCol(content: string, pos: number) {
    let line = 1;
    let col = 1;
    for (let i = 0; i < pos && i < content.length; i++) {
        if (content[i] === "\n") {
            line++;
            col = 1;
        } else {
            col++;
        }
    }
    return { line, col };
}
