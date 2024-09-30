// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import path from "path";
import os from "os";

export function testDirectoryPath(subPath: string) {
    return path.join(os.tmpdir(), subPath);
}
