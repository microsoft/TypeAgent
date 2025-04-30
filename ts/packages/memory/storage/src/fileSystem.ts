// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import fs from "fs";

export function removeFile(filePath: string): boolean {
    try {
        fs.unlinkSync(filePath);
        return true;
    } catch {}
    return false;
}

export function ensureDir(folderPath: string): string {
    if (!fs.existsSync(folderPath)) {
        fs.promises.mkdir(folderPath, { recursive: true });
    }
    return folderPath;
}
