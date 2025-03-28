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
