// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    getBypassMacroToolsEnabled,
    getConfigPath,
    getMacroToolAvailability,
    writeConfig,
} from "../src/shared/plugin-config.js";
import { createExtensionCommands } from "../src/extension/commands.js";
import { handleSlashCommand, routePrompt } from "../src/hooks/hook-router.js";
import { MacroCatalogAdapter } from "../src/mcp/macroServer.js";

describe("explicit macro tools in bypass mode", () => {
    let directory: string;
    const names = [
        "TYPEAGENT_PLUGIN_DATA",
        "TYPEAGENT_MODE",
        "TYPEAGENT_BYPASS_MACRO_TOOLS",
        "COPILOT_AGENT_SESSION_ID",
        "TYPEAGENT_RECIPE_OWNER",
    ] as const;
    const original = Object.fromEntries(
        names.map((name) => [name, process.env[name]]),
    );
    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), "bypass-macro-tools-"));
        for (const name of names) delete process.env[name];
        process.env.TYPEAGENT_PLUGIN_DATA = directory;
    });
    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
        for (const name of names) {
            if (original[name] === undefined) delete process.env[name];
            else process.env[name] = original[name];
        }
    });

    it("defaults to disabled without a file or explicit setting", () => {
        expect(getBypassMacroToolsEnabled()).toBe(false);
        writeConfig({ mode: "bypass" });
        expect(getBypassMacroToolsEnabled()).toBe(false);
        expect(getMacroToolAvailability()).toBe("disabled");
    });

    it.each([false, true])(
        "reads the explicit %s config setting",
        (enabled) => {
            writeConfig({ mode: "bypass", bypassMacroTools: enabled });
            expect(getBypassMacroToolsEnabled()).toBe(enabled);
        },
    );

    it.each([
        ["true", true],
        ["1", true],
        ["on", true],
        [" ON ", true],
        ["false", false],
        ["0", false],
        ["off", false],
    ] as const)(
        "environment %s overrides the saved setting",
        (value, enabled) => {
            writeConfig({ mode: "bypass", bypassMacroTools: !enabled });
            process.env.TYPEAGENT_BYPASS_MACRO_TOOLS = value;
            expect(getBypassMacroToolsEnabled()).toBe(enabled);
        },
    );

    it.each(["", "enabled", "truthy", "2"])(
        "rejects invalid environment value %p",
        (value) => {
            writeConfig({ mode: "bypass", bypassMacroTools: true });
            process.env.TYPEAGENT_BYPASS_MACRO_TOOLS = value;
            expect(() => getBypassMacroToolsEnabled()).toThrow(
                "TYPEAGENT_BYPASS_MACRO_TOOLS must be",
            );
        },
    );

    it.each([null, "true", 1, [], {}])(
        "rejects invalid configured value %p",
        (value) => {
            writeFileSync(
                getConfigPath(),
                JSON.stringify({ mode: "bypass", bypassMacroTools: value }),
            );
            expect(() => getBypassMacroToolsEnabled()).toThrow(
                "bypassMacroTools must be a boolean",
            );
        },
    );

    it("rejects malformed configuration rather than enabling macro tools", () => {
        writeFileSync(getConfigPath(), "{broken");
        expect(() => getBypassMacroToolsEnabled()).toThrow(
            "Unable to read plugin configuration",
        );
    });

    it.each(["direct", "mcp", "dev"] as const)(
        "does not change macro availability in %s mode",
        (mode) => {
            writeConfig({ mode, bypassMacroTools: false });
            expect(getMacroToolAvailability()).toBe("available");
        },
    );

    it.each([false, true])(
        "reports matching hook and extension status with opt-in %s",
        async (enabled) => {
            writeConfig({ mode: "bypass", bypassMacroTools: enabled });
            const expected = enabled
                ? "discovery and execution only"
                : "disabled";
            const hook = await handleSlashCommand({
                prompt: "@typeagent status",
                sessionId: "status-session",
                timestamp: 1,
                cwd: directory,
            });
            const messages: string[] = [];
            const command = createExtensionCommands(async (message) => {
                messages.push(message);
            }).find(({ name }) => name === "typeagent-status");
            await command?.handler({ args: "" } as never);
            expect(hook?.responseContent).toContain(
                `Macro tools: **${expected}**`,
            );
            expect(hook?.responseContent).toContain(
                "Workspace tools: **disabled**",
            );
            expect(messages[0]).toContain(`Macro tools: ${expected}`);
            expect(hook?.responseContent).toContain(
                "Ordinary prompts: Copilot (no local recipe matching)",
            );
            expect(messages[0]).toContain(
                "Ordinary prompts: Copilot (no local recipe matching)",
            );
        },
    );

    it("uses the saved opt-in in the production adapter and still requires a native session", async () => {
        const adapter = new MacroCatalogAdapter();
        writeConfig({ mode: "bypass", bypassMacroTools: false });
        expect((await adapter.listMacros({})).content[0]).toMatchObject({
            text: expect.stringContaining("disabled in bypass"),
        });
        writeConfig({ mode: "bypass", bypassMacroTools: true });
        expect((await adapter.listMacros({})).content[0]).toMatchObject({
            text: "Local recipes require the actual native Copilot session.",
        });
    });

    it("leaves ordinary bypass prompts with Copilot even when macro tools are enabled", async () => {
        writeConfig({ mode: "bypass", bypassMacroTools: true });
        const localRecipes = jest.fn(async () => ({}));
        await expect(
            routePrompt(
                {
                    prompt: "Read the latest package metadata",
                    sessionId: "prompt-session",
                    timestamp: 1,
                    cwd: directory,
                },
                "bypass",
                new AbortController().signal,
                {
                    recipeOwner: () => "plugin",
                    claimRecording: jest.fn(async () => false),
                    localRecipes,
                },
            ),
        ).resolves.toEqual({});
        expect(localRecipes).not.toHaveBeenCalled();
    });
});
