// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleSlashCommand, routePrompt } from "../src/hooks/hook-router.js";
import { createExtensionCommands } from "../src/extension/commands.js";
import { getMcpRouting, readConfig } from "../src/shared/plugin-config.js";
import { handleModeSetting } from "../src/shared/mode-command.js";

describe("explicit TypeAgent mode settings", () => {
    let directory: string;
    const originalData = process.env.TYPEAGENT_PLUGIN_DATA;
    const originalMode = process.env.TYPEAGENT_MODE;
    const originalOwner = process.env.TYPEAGENT_RECIPE_OWNER;
    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), "typeagent-mode-"));
        process.env.TYPEAGENT_PLUGIN_DATA = directory;
        delete process.env.TYPEAGENT_MODE;
        delete process.env.TYPEAGENT_RECIPE_OWNER;
    });
    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
        for (const [key, value] of [
            ["TYPEAGENT_PLUGIN_DATA", originalData],
            ["TYPEAGENT_MODE", originalMode],
            ["TYPEAGENT_RECIPE_OWNER", originalOwner],
        ]) {
            if (value === undefined) delete process.env[key!];
            else process.env[key!] = value;
        }
    });

    it.each(["hook", "extension"])(
        "persists explicit MCP policy through %s",
        async (surface) => {
            const messages: string[] = [];
            if (surface === "hook") {
                const output = await handleSlashCommand({
                    sessionId: "mode-test",
                    timestamp: 1,
                    cwd: directory,
                    prompt: "@typeagent mode mcp mixed",
                });
                messages.push(output?.responseContent ?? "");
            } else {
                const command = createExtensionCommands(async (message) => {
                    messages.push(message);
                }).find(({ name }) => name === "typeagent-mode")!;
                await command.handler({ args: "mcp mixed" } as never);
            }
            expect(messages[0]).toContain("mcp (mixed)");
            expect(readConfig()).toMatchObject({
                mode: "mcp",
                mcpRouting: "mixed",
            });
            expect(messages[0]).toContain("Ordinary prompts");
        },
    );

    it.each(["mcp typo", "mcp mixed extra", "direct mixed", "unknown"])(
        "rejects malformed mode %s",
        (mode) => {
            expect(handleModeSetting(mode, "@typeagent mode")).toContain(
                "Usage:",
            );
            expect(readConfig()).toBeUndefined();
        },
    );

    it.each(["direct", "mcp", "dev"] as const)(
        "uses only local recipes for ordinary prompts in %s",
        async (mode) => {
            const request = {
                sessionId: "mode-test",
                timestamp: 1,
                cwd: directory,
                prompt: "Read current contents",
            };
            const localRecipes = jest.fn(async () => ({}));
            expect(getMcpRouting()).toBe("delegate");
            await expect(
                routePrompt(request, mode, new AbortController().signal, {
                    claimRecording: async () => false,
                    localRecipes,
                }),
            ).resolves.toEqual({});
            expect(localRecipes).toHaveBeenCalledTimes(1);
        },
    );
});
