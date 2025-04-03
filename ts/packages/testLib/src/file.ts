// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";

export function getAbsolutePath(relativePath: string): string {
    return path.join(process.cwd(), relativePath);
}

export function readTestFile(filePath: string): string {
    const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : getAbsolutePath(filePath);
    return fs.readFileSync(absolutePath, "utf-8");
}

/**
 * Reads all lines in a file
 * @param filePath
 * @returns
 */
export function readTestFileLines(filePath: string): string[] {
    const text = readTestFile(filePath);
    if (text) {
        let lines = text.split(/\r?\n/);
        lines = lines.map((l) => l.trim());
        lines = lines.filter((l) => l.length > 0);
        return lines;
    }
    return [];
}
