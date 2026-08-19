// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getCopilotPermissionDefault,
    getCopilotPermissionScopeViolation,
} from "../src/reasoning/copilot.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("Copilot host permission policy", () => {
    it("approves safe reads and readonly MCP tools", () => {
        expect(
            getCopilotPermissionDefault({
                kind: "read",
                path: "README.md",
                intention: "read documentation",
            }),
        ).toEqual({ kind: "approve-once" });
        expect(
            getCopilotPermissionDefault({
                kind: "mcp",
                serverName: "user-server",
                toolName: "delete",
                toolTitle: "Delete",
                readOnly: true,
            }),
        ).toEqual({ kind: "approve-once" });
    });

    it("requires confirmation for unknown or non-readonly MCP tools", () => {
        expect(
            getCopilotPermissionDefault({
                kind: "mcp",
                serverName: "user-server",
                toolName: "unknown",
                toolTitle: "Unknown",
            } as any),
        ).toBeUndefined();
        expect(
            getCopilotPermissionDefault({
                kind: "mcp",
                serverName: "user-server",
                toolName: "delete",
                toolTitle: "Delete",
                readOnly: false,
            }),
        ).toBeUndefined();
    });

    it("requires confirmation for write-capable shell requests", () => {
        expect(
            getCopilotPermissionDefault({
                kind: "shell",
                intention: "write",
                fullCommandText: "echo x > file",
                commands: [{ identifier: "echo", readOnly: false }],
                possiblePaths: ["file"],
                possibleUrls: [],
                hasWriteFileRedirection: true,
                canOfferSessionApproval: false,
            }),
        ).toBeUndefined();
    });

    it("requires confirmation when managed policy requires approval", () => {
        expect(
            getCopilotPermissionDefault({
                kind: "read",
                path: "README.md",
                intention: "read documentation",
                managedApprovalRequired: true,
            }),
        ).toBeUndefined();
    });

    it("rejects coding file access outside the authorized root", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "coding-root-"));
        try {
            expect(
                getCopilotPermissionScopeViolation(
                    {
                        kind: "read",
                        path: path.join(root, "README.md"),
                        intention: "read",
                    },
                    root,
                ),
            ).toBeUndefined();
            expect(
                getCopilotPermissionScopeViolation(
                    {
                        kind: "write",
                        fileName: path.join(root, "..", "outside.md"),
                        diff: "",
                        intention: "write",
                        canOfferSessionApproval: false,
                    },
                    root,
                ),
            ).toMatch(/outside the authorized coding root/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("rejects shell commands that may touch paths outside the root", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "coding-root-"));
        try {
            expect(
                getCopilotPermissionScopeViolation(
                    {
                        kind: "shell",
                        intention: "copy",
                        fullCommandText: "copy file",
                        commands: [{ identifier: "copy", readOnly: false }],
                        possiblePaths: [path.join(root, "..", "outside")],
                        possibleUrls: [],
                        hasWriteFileRedirection: false,
                        canOfferSessionApproval: false,
                    },
                    root,
                ),
            ).toMatch(/outside the authorized coding root/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
