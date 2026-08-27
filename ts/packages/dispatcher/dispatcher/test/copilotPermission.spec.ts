// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getCopilotPermissionDefault,
    getCopilotPermissionChoices,
    getCopilotPermissionScopeViolation,
    formatCopilotPermissionRequest,
} from "../src/reasoning/copilot.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Copilot-adapter-specific behavior. Shared session/request/tool policy is
// covered by reasoningPermissionPolicy.spec.ts; these tests only exercise
// the Copilot SDK -> policy translation and the Copilot-specific prompt
// formatting, safe defaults, and coding-root scope check.

describe("Copilot permission adapter: safe defaults", () => {
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
});

describe("Copilot permission adapter: choice eligibility", () => {
    it("only offers Allow once + Deny for managed policy requests", () => {
        expect(
            getCopilotPermissionChoices({
                kind: "read",
                path: "README.md",
                intention: "read documentation",
                managedApprovalRequired: true,
            }),
        ).toEqual(["Allow once", "Deny"]);
    });

    it("offers session scopes only when the SDK permits it", () => {
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
            "Allow all for session",
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
    });

    it("does not offer host-wide session approval for sandbox bypass", () => {
        const request = {
            kind: "shell" as const,
            intention: "run outside the sandbox",
            fullCommandText: "curl https://example.com",
            commands: [{ identifier: "curl", readOnly: false }],
            possiblePaths: [],
            possibleUrls: [{ url: "https://example.com" }],
            hasWriteFileRedirection: false,
            canOfferSessionApproval: true,
            requestSandboxBypass: true,
        };
        // Sandbox bypass is a mandatory prompt in the shared policy, so only
        // Allow once + Deny should surface.
        expect(getCopilotPermissionChoices(request)).toEqual([
            "Allow once",
            "Deny",
        ]);
    });

    it("offers scoped and blanket session choices for custom tools", () => {
        expect(
            getCopilotPermissionChoices({
                kind: "custom-tool",
                toolName: "execute_action",
                toolDescription: "Run a TypeAgent action",
            }),
        ).toEqual([
            "Allow once",
            "Allow this tool for request",
            "Allow all for request",
            "Allow this tool for session",
            "Allow all for session",
            "Deny",
        ]);
    });
});

describe("Copilot permission adapter: prompt formatting", () => {
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
            toolName: "remember",
            toolDescription: "Save information for future conversations",
            args: { text: "Preference supplied by the user" },
        });
        expect(message).toBe("Copilot wants to run custom tool 'remember'.");
    });
});

describe("Copilot permission adapter: coding root scope", () => {
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
