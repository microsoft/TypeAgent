// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";
import { prewarmCopilotReasoning } from "../src/reasoning/copilot.js";

describe("Copilot reasoning runtime selection", () => {
    const envKeys = [
        "TYPEAGENT_COPILOT_CLI_PATH",
        "COPILOT_CLI_PATH",
        "TYPEAGENT_GHCP_EVAL_CLI",
        "TYPEAGENT_COPILOT_CREDIT_LEDGER",
    ] as const;
    let savedEnv: (string | undefined)[];
    let tempDir: string;

    beforeEach(() => {
        savedEnv = envKeys.map((key) => process.env[key]);
        for (const key of envKeys) {
            delete process.env[key];
        }
        tempDir = mkdtempSync(path.join(os.tmpdir(), "ta-reasoning-runtime-"));
        jest.spyOn(os, "tmpdir").mockReturnValue(tempDir);
        jest.spyOn(CopilotClient.prototype, "start").mockRejectedValue(
            new Error("Test does not launch a runtime"),
        );
        jest.spyOn(RuntimeConnection, "forStdio");
    });

    afterEach(() => {
        jest.restoreAllMocks();
        envKeys.forEach((key, index) => {
            const value = savedEnv[index];
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        });
        rmSync(tempDir, { recursive: true, force: true });
    });

    test.each([
        {
            name: "prefers the TypeAgent managed executable",
            managed: "C:\\managed\\copilot.exe",
            generic: "C:\\generic\\copilot.exe",
            expected: "C:\\managed\\copilot.exe",
        },
        {
            name: "uses the generic configured executable",
            generic: "C:\\generic\\copilot.exe",
            expected: "C:\\generic\\copilot.exe",
        },
        {
            name: "retains SDK discovery without configuration",
            expected: undefined,
        },
        {
            name: "ignores the evaluation executable without a credit budget",
            managed: "C:\\managed\\copilot.exe",
            evaluation: "C:\\evaluation\\copilot.exe",
            expected: "C:\\managed\\copilot.exe",
        },
        {
            name: "prefers the evaluation executable with a credit budget",
            managed: "C:\\managed\\copilot.exe",
            generic: "C:\\generic\\copilot.exe",
            evaluation: "C:\\evaluation\\copilot.exe",
            creditBudget: true,
            expected: "C:\\evaluation\\copilot.exe",
        },
        {
            name: "uses the managed executable for credit budgets without an evaluation override",
            managed: "C:\\managed\\copilot.exe",
            creditBudget: true,
            expected: "C:\\managed\\copilot.exe",
        },
    ])(
        "$name",
        async ({ managed, generic, evaluation, creditBudget, expected }) => {
            if (managed) process.env.TYPEAGENT_COPILOT_CLI_PATH = managed;
            if (generic) process.env.COPILOT_CLI_PATH = generic;
            if (evaluation) process.env.TYPEAGENT_GHCP_EVAL_CLI = evaluation;
            if (creditBudget) {
                process.env.TYPEAGENT_COPILOT_CREDIT_LEDGER = path.join(
                    tempDir,
                    "ledger.json",
                );
            }
            const context = {
                session: {
                    getConfig: () => ({ execution: { reasoning: "copilot" } }),
                },
            } as unknown as CommandHandlerContext;

            prewarmCopilotReasoning(context);
            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(CopilotClient.prototype.start).toHaveBeenCalledTimes(1);
            expect(RuntimeConnection.forStdio).toHaveBeenCalledWith(
                expected ? { path: expected } : {},
            );
        },
    );
});
