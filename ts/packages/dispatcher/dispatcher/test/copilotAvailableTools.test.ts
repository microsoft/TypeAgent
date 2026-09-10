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

    test.each([
        ["claude-opus-4.8", ["view", "edit", "create", "grep"]],
        ["gpt-5.4", ["view", "apply_patch", "rg"]],
    ] as const)("%s exposes usable native tools", async (model, editors) => {
        const session = await client.createSession({
            model,
            workingDirectory,
            availableTools: buildCopilotAvailableTools({
                subagentsEnabled: false,
            }),
            onPermissionRequest: () => ({
                kind: "denied-no-approval-rule-and-could-not-request-from-user",
            }),
        });
        try {
            // Unlike the static global listing, this applies the host platform,
            // model overrides and our allowlist. No model request is sent.
            await session.rpc.tools.initializeAndValidate();
            const { tools } = await session.rpc.tools.getCurrentMetadata();
            expect(tools).not.toBeNull();
            const names = tools?.map((tool) => tool.name);
            const shell = process.platform === "win32" ? "powershell" : "bash";
            expect(names).toEqual(
                expect.arrayContaining([
                    ...editors,
                    "glob",
                    "web_fetch",
                    shell,
                    `read_${shell}`,
                    `stop_${shell}`,
                    `list_${shell}`,
                ]),
            );
            for (const excluded of ["task", "run_factory", "skill"]) {
                expect(names).not.toContain(excluded);
            }
        } finally {
            await client.deleteSession(session.sessionId);
        }
    });
});
