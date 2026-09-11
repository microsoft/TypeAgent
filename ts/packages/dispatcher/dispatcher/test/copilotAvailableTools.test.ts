// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { buildCopilotAvailableTools } from "../src/reasoning/copilot.js";

// Jest's ESM VM lacks import.meta.resolve; use the SDK's CommonJS entry so its
// bundled CLI resolver can use Node's native module resolution.
const { CopilotClient }: typeof import("@github/copilot-sdk") = createRequire(
    import.meta.url,
)("@github/copilot-sdk");

describe("installed Copilot runtime tool contract", () => {
    const client = new CopilotClient();
    let workingDirectory: string;

    beforeAll(async () => {
        workingDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-tool-contract-"),
        );
        await client.start();
    });

    afterAll(async () => {
        try {
            expect(await client.stop()).toEqual([]);
        } finally {
            fs.rmSync(workingDirectory, { recursive: true, force: true });
        }
    });

});
