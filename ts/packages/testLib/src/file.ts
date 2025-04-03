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
