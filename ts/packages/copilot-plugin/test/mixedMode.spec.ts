// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleSlashCommand } from "../src/hooks/hook-router.js";
import { handleMcpRedirect } from "../src/hooks/hook-mcp-redirect.js";
import { createExtensionCommands } from "../src/extension/commands.js";
import { getPowerShellHookOutput } from "../src/extension/powershell-guidance.js";
import {
    getMcpRouting,
    getModeLabel,
    isMixedMcpMode,
    readConfig,
    writeConfig,
} from "../src/shared/plugin-config.js";
import { handleModeSetting } from "../src/shared/mode-command.js";

const input = {
    sessionId: "mixed-test",
    timestamp: 1,
    cwd: ".",
    prompt: "Show my lists",
};

describe("mixed MCP routing", () => {
    let directory: string;
    const originalData = process.env.TYPEAGENT_PLUGIN_DATA;
    const originalMode = process.env.TYPEAGENT_MODE;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), "typeagent-mixed-"));
        process.env.TYPEAGENT_PLUGIN_DATA = directory;
        delete process.env.TYPEAGENT_MODE;
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
        if (originalData === undefined)
            delete process.env.TYPEAGENT_PLUGIN_DATA;
        else process.env.TYPEAGENT_PLUGIN_DATA = originalData;
        if (originalMode === undefined) delete process.env.TYPEAGENT_MODE;
        else process.env.TYPEAGENT_MODE = originalMode;
    });

    it("defaults to delegation without steering selected steps to structured calls", () => {
        expect(getMcpRouting()).toBe("delegate");
        handleModeSetting("mcp", "@typeagent mode");
        const output = handleMcpRedirect(input);
        expect(output.modifiedPrompt).toBe(input.prompt);
        expect(output.additionalContext).toContain(
            "You MUST call the typeagent-processCommand tool with the user's exact request",
        );
        expect(output.additionalContext).toContain(
            "do not split it into Copilot-selected structured actions",
        );
        expect(output.additionalContext).not.toContain(
            "typeagent-searchActions",
        );
        expect(output.additionalContext).not.toContain(
            "typeagent-executeAction",
        );
    });

    it.each(["hook", "extension"])(
        "persists and reports policy through the %s command",
        async (surface) => {
            writeConfig({
                mode: "direct",
                conversationId: "existing",
                powershell: { enabled: false },
                selectedSkills: [
                    {
                        identity: {
                            scope: "user",
                            origin: "test",
                            name: "calendar",
                        },
                    },
                ],
            });
            const messages: string[] = [];
            const direct = jest.fn(async () => ({}));
            const command = createExtensionCommands(async (message) => {
                messages.push(message);
            }).find(({ name }) => name === "typeagent-mode")!;
            const run = async (args: string) => {
                if (surface === "extension") {
                    await command.handler({ args } as never);
                } else {
                    const output = await handleSlashCommand(
                        { ...input, prompt: `@typeagent mode ${args}`.trim() },
                        { direct },
                    );
                    expect(output?.handled).toBe(true);
                    messages.push(output?.responseContent ?? "");
                }
            };
            await run("MCP MIXED");
            await run("");
            expect(messages[0]).toMatch(
                /^TypeAgent mode switched to mcp \(mixed\)\./,
            );
            expect(messages[1]).toMatch(/^TypeAgent mode: mcp \(mixed\)/);
            for (const message of messages) {
                expect(message).toContain("Mixed policy:");
                expect(message).toContain("searchActions/executeAction");
            }
            await run("direct");
            expect(isMixedMcpMode()).toBe(false);
            await run("mcp");
            expect(getModeLabel()).toBe("mcp (mixed)");
            expect(readConfig()).toMatchObject({
                mode: "mcp",
                mcpRouting: "mixed",
                conversationId: "existing",
                powershell: { enabled: false },
                selectedSkills: [
                    {
                        identity: {
                            scope: "user",
                            origin: "test",
                            name: "calendar",
                        },
                    },
                ],
            });
            await run("mcp delegate");
            expect(getModeLabel()).toBe("mcp (delegate)");
            expect(messages[messages.length - 1]).toContain(
                "Delegate policy (default):",
            );
            expect(direct).not.toHaveBeenCalled();
        },
    );

    it.each([
        "mcp typo",
        "mcp mixed extra",
        "direct mixed",
        "mixed",
        "dev delegate",
        "mcp mixed\nextra",
        "mcp\ninvalid",
    ])(
        "rejects invalid mode arguments without delegating or changing config: %s",
        async (args) => {
            writeConfig({ mode: "mcp", mcpRouting: "mixed" });
            const direct = jest.fn(async () => ({}));
            const output = await handleSlashCommand(
                { ...input, prompt: `@typeagent mode ${args}` },
                { direct },
            );
            expect(output?.responseContent).toContain("Usage:");
            expect(output?.handled).toBe(true);
            const messages: string[] = [];
            const command = createExtensionCommands(async (message) => {
                messages.push(message);
            }).find(({ name }) => name === "typeagent-mode")!;
            await command.handler({ args } as never);
            expect(messages).toEqual([
                "Usage: /typeagent-mode direct|mcp [delegate|mixed]|dev|bypass",
            ]);
            expect(readConfig()).toEqual({ mode: "mcp", mcpRouting: "mixed" });
            expect(direct).not.toHaveBeenCalled();
        },
    );

    it("reports effective mode when an environment override prevents activation", () => {
        process.env.TYPEAGENT_MODE = "direct";
        const message = handleModeSetting("mcp mixed", "@typeagent mode");
        expect(message).toContain(
            "Saved TypeAgent mode: mcp (mixed). Effective mode: direct (TYPEAGENT_MODE override).",
        );
        expect(message).not.toContain("Mixed policy:");
        expect(message).toContain(
            "The hook handles user natural language directly.",
        );
        expect(isMixedMcpMode()).toBe(false);
        delete process.env.TYPEAGENT_MODE;
        expect(isMixedMcpMode()).toBe(true);
    });

    it.each(["delegate", "mixed"] as const)(
        "shows %s routing and shared scope in both status surfaces",
        async (mcpRouting) => {
            writeConfig({ mode: "mcp", mcpRouting });
            const output = await handleSlashCommand({
                ...input,
                prompt: "@typeagent status",
            });
            expect(output?.responseContent).toContain(`mcp (${mcpRouting})`);
            expect(output?.responseContent).toContain("shared by sessions");
            const description =
                mcpRouting === "mixed"
                    ? "Mixed policy: Copilot chooses"
                    : "Delegate policy (default): delegate the user's exact request through processCommand.";
            expect(output?.responseContent).toContain(description);
            expect(output?.responseContent).toContain(
                "preserving saved policy (default: delegate)",
            );
            const log = jest.fn(async (_message: string) => {});
            const command = createExtensionCommands(log).find(
                ({ name }) => name === "typeagent-status",
            )!;
            await command.handler({} as never);
            expect(log).toHaveBeenCalledWith(
                expect.stringContaining(`mcp (${mcpRouting})`),
            );
            expect(log).toHaveBeenCalledWith(
                expect.stringContaining(description),
            );
            expect(log).toHaveBeenCalledWith(
                expect.stringContaining("shared by sessions"),
            );
        },
    );

    it.each(["direct", "mcp", "dev", "bypass"] as const)(
        "consumes multiline mode arguments locally from %s mode",
        async (mode) => {
            writeConfig({ mode });
            const direct = jest.fn(async () => ({}));
            const output = await handleSlashCommand(
                { ...input, prompt: " \t@TYPEAGENT mode MCP\nMIXED \n" },
                { direct },
            );
            expect(output?.handled).toBe(true);
            expect(output?.responseContent).toContain("mcp (mixed)");
            expect(readConfig()).toEqual({ mode: "mcp", mcpRouting: "mixed" });
            expect(direct).not.toHaveBeenCalled();
        },
    );

    it.each([
        "Show my lists",
        "Create a list and add these three items",
        "Review this diff and track missing tests in a list",
        "Explain this function",
        'Keep "quotes", \u6771\u4eac and\nnewlines',
    ])("lets Copilot judge ownership without rewriting: %s", (prompt) => {
        writeConfig({ mode: "mcp", mcpRouting: "mixed" });
        const output = handleMcpRedirect({ ...input, prompt });
        expect(output.modifiedPrompt).toBe(prompt);
        expect(output.additionalContext).toContain(
            "[TypeAgent MCP routing: mixed]",
        );
        expect(output.additionalContext).toContain("whole-request delegation");
        expect(output.additionalContext).toContain(
            "intermediate actions YOU select",
        );
        expect(output.additionalContext).toContain(
            "Do not apply a blanket search-first rule",
        );
        expect(output.additionalContext).toContain(
            "Never replay uncertain delivery",
        );
        expect(output.additionalContext).not.toContain("SYSTEM HOOK DIRECTIVE");
        expect(output.additionalContext).not.toContain(
            "prefer typeagent-processCommand with natural language over direct PowerShell",
        );
    });

    it.each(["learn:", "dev:", "record:", "dev: learn:"])(
        "keeps recording directive %s on exact natural-language delegation",
        (prefix) => {
            writeConfig({ mode: "mcp", mcpRouting: "mixed" });
            const prompt = `${prefix} find large files`;
            const output = handleMcpRedirect({ ...input, prompt });
            expect(output.modifiedPrompt).toBe(prompt);
            expect(output.additionalContext).toContain(
                "You MUST call the typeagent-processCommand",
            );
            expect(output.additionalContext).toContain(
                "SPECIAL PREFIX DETECTED",
            );
            expect(output.additionalContext).not.toContain(
                "typeagent-searchActions",
            );
            expect(output.additionalContext).not.toContain(
                "typeagent-executeAction",
            );
        },
    );

    it("uses ownership-aware PowerShell guidance only in mixed mode and honors off", () => {
        writeConfig({ mode: "mcp", mcpRouting: "mixed" });
        const args = { command: "Get-ChildItem" };
        const mixed = getPowerShellHookOutput(
            "powershell",
            args,
        )?.additionalContext;
        expect(mixed).toContain("intermediate operation you select");
        expect(mixed).toContain("typeagent-searchActions");
        expect(mixed).not.toContain("instead of direct PowerShell");
        writeConfig({ mode: "mcp", mcpRouting: "delegate" });
        expect(
            getPowerShellHookOutput("powershell", args)?.additionalContext,
        ).toContain("typeagent-processCommand instead of direct PowerShell");
        for (const mcpRouting of ["delegate", "mixed"] as const) {
            writeConfig({
                mode: "mcp",
                mcpRouting,
                powershell: { enabled: false },
            });
            expect(getPowerShellHookOutput("powershell", args)).toBeUndefined();
            expect(handleMcpRedirect(input).additionalContext).not.toContain(
                "[TypeAgent PowerShell reminder]",
            );
        }
    });
});
