// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExtensionCommands } from "../src/extension/commands.js";
import { getPowerShellHookOutput } from "../src/extension/powershell-guidance.js";

describe("extension commands", () => {
    let dataDir: string;
    const originalDataDir = process.env.TYPEAGENT_PLUGIN_DATA;
    const originalMode = process.env.TYPEAGENT_MODE;

    beforeEach(() => {
        dataDir = mkdtempSync(join(tmpdir(), "typeagent-copilot-"));
        process.env.TYPEAGENT_PLUGIN_DATA = dataDir;
        delete process.env.TYPEAGENT_MODE;
    });

    afterEach(() => {
        rmSync(dataDir, { recursive: true, force: true });
        if (originalDataDir === undefined)
            delete process.env.TYPEAGENT_PLUGIN_DATA;
        else process.env.TYPEAGENT_PLUGIN_DATA = originalDataDir;
        if (originalMode === undefined) delete process.env.TYPEAGENT_MODE;
        else process.env.TYPEAGENT_MODE = originalMode;
    });

    it("reports status using the default configuration", async () => {
        const messages: string[] = [];
        const command = createExtensionCommands(async (message) => {
            messages.push(message);
        }).find(({ name }) => name === "typeagent-status");

        await command?.handler({} as never);

        expect(messages[0]).toContain("Mode: direct");
        expect(messages[0]).toContain("TypeAgent PowerShell: on");
        expect(messages[0]).toContain("Server: ws://localhost:8999");
    });

    it("persists a valid mode and rejects an invalid mode", async () => {
        const messages: string[] = [];
        const command = createExtensionCommands(async (message) => {
            messages.push(message);
        }).find(({ name }) => name === "typeagent-mode");

        await command?.handler({ args: "mcp" } as never);
        await command?.handler({ args: "invalid" } as never);

        expect(
            JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")),
        ).toMatchObject({ mode: "mcp" });
        expect(messages).toEqual([
            "TypeAgent mode switched to mcp.",
            "Usage: /typeagent-mode direct|mcp|dev|bypass",
        ]);
    });
});

describe("PowerShell extension guidance", () => {
    const originalMode = process.env.TYPEAGENT_MODE;

    afterEach(() => {
        if (originalMode === undefined) delete process.env.TYPEAGENT_MODE;
        else process.env.TYPEAGENT_MODE = originalMode;
    });

    it("guides direct PowerShell commands in direct mode", () => {
        process.env.TYPEAGENT_MODE = "direct";

        expect(
            getPowerShellHookOutput("powershell", {
                command: "Get-ChildItem C:\\repo",
            })?.additionalContext,
        ).toContain("typeagent-processCommand");
    });

    it.each([
        ["bypass", "powershell", "Get-ChildItem"],
        ["dev", "powershell", "Get-ChildItem"],
        ["direct", "bash", "Get-ChildItem"],
        ["direct", "powershell", "git status"],
    ])(
        "does not guide mode %s, tool %s, command %s",
        (mode, toolName, command) => {
            process.env.TYPEAGENT_MODE = mode;

            expect(
                getPowerShellHookOutput(toolName, { command }),
            ).toBeUndefined();
        },
    );
});
