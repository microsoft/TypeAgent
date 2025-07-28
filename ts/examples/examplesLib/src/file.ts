// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";
import { isFilePath } from "typeagent";

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

export function getAbsolutePath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
        return relativePath;
    }
    return path.join(process.cwd(), relativePath);
}

export function getTextOrFile(text: string): string {
    return isFilePath(text) ? fs.readFileSync(text, "utf-8") : text;
}
