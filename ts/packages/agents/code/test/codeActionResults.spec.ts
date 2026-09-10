// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    displayCodaResult,
    getActionResponseTimeoutMs,
} from "../src/codeActionHandler.js";

describe("code action structured results", () => {
    test("relays a Coda workspace command result as structured raw data", () => {
        const result = displayCodaResult(
            JSON.stringify({
                success: true,
                exitCode: 0,
                durationMs: 125,
                stdout: { text: "ok", truncated: false, totalBytes: 2 },
                stderr: { text: "", truncated: false, totalBytes: 0 },
                timedOut: false,
                cancelled: false,
                executionId: "test",
            }),
        );

        expect(result).toMatchObject({
            type: "structured",
            rawData: {
                success: true,
                exitCode: 0,
                stdout: { text: "ok" },
            },
        });
    });

    test("uses the command timeout plus transport cleanup allowance", () => {
        expect(
            getActionResponseTimeoutMs({
                actionName: "runWorkspaceCommand",
                parameters: { timeoutMs: 10_000 },
            }),
        ).toBe(20_000);
        expect(
            getActionResponseTimeoutMs({
                actionName: "workbenchOpenFile",
            }),
        ).toBe(5_000);
    });
});
