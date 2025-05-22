// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";

export function readBatchFile(filePath: string, commentPrefix = "#"): string[] {
    const text = fs.readFileSync(filePath, "utf-8");
    if (!text) {
        return [];
    }

    let lines = text.split(/\r?\n/);
    lines = lines.map((l) => l.trim());
    lines = lines.filter((l) => l.length > 0 && !l.startsWith(commentPrefix));
    return lines;
}
