// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExtensionCommands } from "../src/extension/commands.js";
import { getPowerShellHookOutput } from "../src/extension/powershell-guidance.js";
import { getSelectedSkills, writeConfig } from "../src/shared/plugin-config.js";

describe("extension commands", () => {
    let dataDir: string;
    const originalDataDir = process.env.TYPEAGENT_PLUGIN_DATA;
    const originalMode = process.env.TYPEAGENT_MODE;
    const originalSelectedSkills = process.env.TYPEAGENT_SELECTED_SKILLS;

    beforeEach(() => {
        dataDir = mkdtempSync(join(tmpdir(), "typeagent-copilot-"));
        process.env.TYPEAGENT_PLUGIN_DATA = dataDir;
        delete process.env.TYPEAGENT_MODE;
        delete process.env.TYPEAGENT_SELECTED_SKILLS;
    });

    afterEach(() => {
        rmSync(dataDir, { recursive: true, force: true });
        if (originalDataDir === undefined)
            delete process.env.TYPEAGENT_PLUGIN_DATA;
        else process.env.TYPEAGENT_PLUGIN_DATA = originalDataDir;
        if (originalMode === undefined) delete process.env.TYPEAGENT_MODE;
        else process.env.TYPEAGENT_MODE = originalMode;
        if (originalSelectedSkills === undefined)
            delete process.env.TYPEAGENT_SELECTED_SKILLS;
        else process.env.TYPEAGENT_SELECTED_SKILLS = originalSelectedSkills;
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
            "TypeAgent mode switched to mcp (delegate).",
            "Usage: /typeagent-mode direct|mcp [delegate|mixed]|dev|bypass",
        ]);
    });

    it("loads explicit selected skills from plugin configuration", () => {
        writeConfig({
            mode: "direct",
            selectedSkills: [
                {
                    identity: {
                        scope: "project",
                        origin: "c:/src/project",
                        name: "calendar",
                    },
                    revision: "a".repeat(64),
                },
            ],
        });

        expect(getSelectedSkills()).toEqual([
            {
                identity: {
                    scope: "project",
                    origin: "c:/src/project",
                    name: "calendar",
                },
                revision: "a".repeat(64),
            },
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
