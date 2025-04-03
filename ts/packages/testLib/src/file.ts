// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";

export function getAbsolutePath(relativePath: string): string {
    return path.join(process.cwd(), relativePath);
}

export function readTestFile(relativePath: string): string {
    const absolutePath = getAbsolutePath(relativePath);
    return fs.readFileSync(absolutePath, "utf-8");
}

export function readTestFileLines(relativePath: string): string[] {
    const text = readTestFile(relativePath);
    if (text) {
        let lines = text.split(/\r?\n/);
        lines = lines.map((l) => l.trim());
        lines = lines.filter((l) => l.length > 0);
        return lines;
    }
    return [];
}
