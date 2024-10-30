// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import os from "node:os";
import { ensureDir } from "typeagent";

export function skipTest(name: string) {
    return test.skip(name, () => {});
}

export async function ensureTestDir() {
    return ensureDir(getRootDataPath());
}

export function getRootDataPath() {
    return path.join(os.tmpdir(), "/data/tests/memoryProviders");
}

export function testFilePath(fileName: string): string {
    return path.join(getRootDataPath(), fileName);
}
