// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getCopilotPermissionDefault,
    getCopilotPermissionChoices,
    getCopilotPermissionScopeViolation,
    getCopilotSessionApproval,
    getCopilotPermissionSessionApproval,
    formatCopilotPermissionRequest,
    setCopilotPermissionSessionApproval,
} from "../src/reasoning/copilot.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("Copilot host permission policy", () => {
    it("tracks session approval per dispatcher context", () => {
        const first = {};
        const second = {};
        expect(getCopilotPermissionSessionApproval(first)).toBe(false);
        setCopilotPermissionSessionApproval(first, true);
        expect(getCopilotPermissionSessionApproval(first)).toBe(true);
        expect(getCopilotPermissionSessionApproval(second)).toBe(false);
        setCopilotPermissionSessionApproval(first, false);
        expect(getCopilotPermissionSessionApproval(first)).toBe(false);
    });

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
        expect(
            getCopilotPermissionChoices({
                kind: "read",
                path: "README.md",
                intention: "read documentation",
                managedApprovalRequired: true,
            }),
        ).toEqual(["Allow once", "Deny"]);
    });

    it("offers session approval only when the SDK permits it", () => {
        const shell = {
            kind: "shell" as const,
            intention: "write",
            fullCommandText: "echo x > file",
            commands: [{ identifier: "echo", readOnly: false }],
            possiblePaths: ["file"],
            possibleUrls: [],
            hasWriteFileRedirection: true,
        };
        expect(
            getCopilotPermissionChoices({
                ...shell,
                canOfferSessionApproval: false,
            }),
        ).toEqual([
            "Allow once",
            "Allow this tool for request",
            "Allow all for request",
            "Deny",
        ]);
        expect(
            getCopilotPermissionChoices({
                ...shell,
                canOfferSessionApproval: true,
            }),
        ).toEqual([
            "Allow once",
            "Allow this tool for request",
            "Allow all for request",
            "Allow this tool for session",
            "Allow all for session",
            "Deny",
        ]);
        expect(
            getCopilotSessionApproval({
                ...shell,
                canOfferSessionApproval: true,
            }),
        ).toEqual({
            kind: "approve-for-session",
            approval: {
                kind: "commands",
                commandIdentifiers: ["echo"],
            },
        });
    });

    it("offers scoped and blanket session choices for custom tools", () => {
        const request = {
            kind: "custom-tool" as const,
            toolName: "execute_action",
            toolDescription: "Run a TypeAgent action",
        };
        expect(getCopilotPermissionChoices(request)).toEqual([
            "Allow once",
            "Allow this tool for request",
            "Allow all for request",
            "Allow this tool for session",
            "Allow all for session",
            "Deny",
        ]);
        expect(getCopilotSessionApproval(request)).toEqual({
            kind: "approve-for-session",
            approval: {
                kind: "custom-tool",
                toolName: "execute_action",
            },
        });
    });

    it("highlights sandbox bypass and consequential request details", () => {
        const message = formatCopilotPermissionRequest({
            kind: "shell",
            intention: "download a release",
            fullCommandText: "curl https://example.com",
            commands: [{ identifier: "curl", readOnly: false }],
            possiblePaths: [],
            possibleUrls: [{ url: "https://example.com" }],
            hasWriteFileRedirection: false,
            canOfferSessionApproval: true,
            requestSandboxBypass: true,
            requestSandboxBypassReason: "network policy blocked the request",
        });
        expect(message).toContain("https://example.com");
        expect(message).toContain("ELEVATED RISK");
        expect(message).toContain("network policy blocked the request");
    });

    it("shows only the custom tool identity", () => {
        const message = formatCopilotPermissionRequest({
            kind: "custom-tool",
            toolName: "discover_actions",
            toolDescription: "Run a TypeAgent action",
            args: { actionName: "listFiles", path: "src" },
        });
        expect(message).toBe(
            "Copilot wants to run custom tool 'discover_actions'.",
        );
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
