// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/*
 * NOTE: This test has the extension .test.ts and not .spec.ts.
 * *.test.ts files are run under test:live && test:live:debug
 * project settings (see ../package.json).  The assumption is
 * test:live has API endpoints where as test:local tests run
 * wholly locally.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { defineTranslateTest } from "./translateTestCommon.js";
const dataFiles = ["test/data/translate-mcpfs-e2e.json"];

const tempDir = path.join(os.tmpdir(), ".typeagent");
try {
    await fs.promises.mkdir(tempDir, { recursive: true });
} catch (e) {}

await defineTranslateTest("translate mcp filesystem", dataFiles, {
    getInstanceDir: () => undefined,
    getInstanceConfig: () => {
        return {
            mcpServers: {
                mcpfilesystem: {
                    // The test is only for translate, so just use the tmp dir as an allowed dir.
                    serverScriptArgs: [tempDir],
                },
            },
        };
    },
    setInstanceConfig: () => {
        throw new Error("not implemented");
    },
});
