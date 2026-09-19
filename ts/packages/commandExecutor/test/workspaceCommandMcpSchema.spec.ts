// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CancelWorkspaceCommandInputSchema,
    CancelWorkspaceCommandResultSchema,
    WorkspaceCommandInputSchema,
    WorkspaceCommandResultSchema,
} from "../src/workspaceCommandMcpSchema.js";

describe("workspace command MCP schemas", () => {
    test("accepts a focused test command with a workspace-relative directory", () => {
        expect(
            WorkspaceCommandInputSchema.parse({
                command: "pnpm test -- --runInBand",
                workspaceFolder: "TypeAgent",
                workingDirectory: "ts/packages/coda",
                timeoutMs: 120_000,
                executionId: "coda-tests",
            }),
        ).toEqual({
            command: "pnpm test -- --runInBand",
            workspaceFolder: "TypeAgent",
            workingDirectory: "ts/packages/coda",
            timeoutMs: 120_000,
            executionId: "coda-tests",
        });
    });

    test("rejects an invalid timeout, oversized UTF-8 command, and empty execution ID", () => {
        expect(() =>
            WorkspaceCommandInputSchema.parse({
                command: "pnpm test",
                timeoutMs: 300_001,
            }),
        ).toThrow();
        expect(() =>
            WorkspaceCommandInputSchema.parse({
                command: "😀".repeat(4_097),
                executionId: "coda-tests",
            }),
        ).toThrow();
        expect(() =>
            CancelWorkspaceCommandInputSchema.parse({ executionId: "" }),
        ).toThrow();
    });

    test("treats executionId as optional so grammar-sourced actions stay valid", () => {
        // The .agr grammar and the code-workbench action schema both omit
        // executionId; the Code Agent assigns one. Requiring it here would
        // reject actions the action schema declares valid.
        expect(
            WorkspaceCommandInputSchema.parse({ command: "pnpm test" }),
        ).toEqual({ command: "pnpm test" });
        expect(() =>
            WorkspaceCommandInputSchema.parse({
                command: "pnpm test",
                executionId: "",
            }),
        ).toThrow();
    });

    test("keeps success, failure, and cancellation result contracts distinct", () => {
        expect(
            WorkspaceCommandResultSchema.parse({
                success: false,
                exitCode: 1,
                durationMs: 25,
                stdout: { text: "", truncated: false, totalBytes: 0 },
                stderr: { text: "failed", truncated: false, totalBytes: 6 },
                timedOut: false,
                cancelled: false,
                executionId: "coda-tests",
            }),
        ).toMatchObject({ success: false, exitCode: 1 });
        expect(
            CancelWorkspaceCommandResultSchema.parse({
                success: true,
                cancelled: true,
                pendingCancellation: false,
                executionId: "coda-tests",
            }),
        ).toMatchObject({ cancelled: true });
    });
});
