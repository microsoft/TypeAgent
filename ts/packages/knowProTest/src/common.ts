// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";

export function ensureDirSync(folderPath: string): string {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
    return folderPath;
}
