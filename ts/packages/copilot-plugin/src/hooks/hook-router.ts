// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Hook entry point that routes to the appropriate handler based on configuration.
 *
 * Mode selection (in priority order):
 * 1. TYPEAGENT_MODE environment variable ("direct" | "mcp" | "dev" | "bypass")
 * 2. Config file at <configDir>/config.json
 * 3. Default: "direct"
 *
 * Slash commands (intercepted before routing):
 *   @typeagent mode direct   — switch to direct mode
 *   @typeagent mode mcp      — switch to MCP mode
 *   @typeagent mode          — show current mode
 *   @typeagent status        — show current configuration
 */

import { handleDirect } from "./hook-direct.js";
import { handleMcpRedirect } from "./hook-mcp-redirect.js";
import { handleDevActions } from "./hook-dev-actions.js";
import { makeTurnId, writeDemoState } from "./demo-state.js";
import type { HookInput, HookOutput } from "./types.js";
import {
    getConfigPath,
    getMode,
    readConfig,
    writeConfig,
    type Mode,
} from "../shared/plugin-config.js";

const modeDescriptions: Record<Mode, string> = {
    direct: "Hook handles requests directly, bypassing the LLM. Workspace macro tools remain available.",
    mcp: "Hook redirects to the TypeAgent MCP tool. Workspace macro tools remain available.",
    dev: "TypeAgent handles registered PowerShell flows and recording directives; other requests fall through to Copilot. Workspace macro tools remain available.",
    bypass: "TypeAgent is disabled. All requests bypass TypeAgent routing and fall through to other handlers.",
};

/**
 * Handle @typeagent slash commands. Returns a HookOutput if the command
 * was handled, or undefined if the prompt is not a slash command.
 * Returns a Promise for commands that need async work (e.g., @typeagent run).
 */
function handleSlashCommand(
    prompt: string,
): HookOutput | Promise<HookOutput> | undefined {
    const trimmed = prompt.trim();
    const lower = trimmed.toLowerCase();

    // @typeagent run <command> — force-route to TypeAgent directly
    const runMatch = trimmed.match(/^@typeagent\s+run\s+(.+)$/i);
    if (runMatch) {
        const command = runMatch[1];
        return handleDirect({
            prompt: command,
            sessionId: "",
            timestamp: 0,
            cwd: "",
        });
    }

    // @typeagent mode <direct|mcp|dev|bypass>
    const modeMatch = lower.match(
        /^@typeagent\s+mode(?:\s+(direct|mcp|dev|bypass))?\s*$/,
    );
    if (modeMatch) {
        const newMode = modeMatch[1] as Mode | undefined;

        if (!newMode) {
            // Show current mode
            const current = getMode();
            return {
                handled: true,
                responseContent: `TypeAgent mode: **${current}**\n\nUse \`@typeagent mode direct\`, \`@typeagent mode mcp\`, \`@typeagent mode dev\`, or \`@typeagent mode bypass\` to switch.`,
                handledBy: "typeagent",
            };
        }

        const config = readConfig() ?? { mode: "direct" };
        config.mode = newMode;
        writeConfig(config);

        return {
            handled: true,
            responseContent: `TypeAgent mode switched to **${newMode}**.  \n${modeDescriptions[newMode]}`,
            handledBy: "typeagent",
        };
    }

    // @typeagent powershell <on|off|status>
    const psMatch = lower.match(/^@typeagent\s+powershell(?:\s+(on|off))?\s*$/);
    if (psMatch) {
        const setting = psMatch[1] as "on" | "off" | undefined;

        if (!setting) {
            const config = readConfig();
            const enabled = config?.powershell?.enabled ?? true;
            return {
                handled: true,
                responseContent: `TypeAgent PowerShell: **${enabled ? "on" : "off"}**\n\nUse \`@typeagent powershell on\` or \`@typeagent powershell off\` to toggle.`,
                handledBy: "typeagent",
            };
        }

        const config = readConfig() ?? { mode: "direct" };
        if (!config.powershell) config.powershell = {};
        config.powershell.enabled = setting === "on";
        writeConfig(config);

        return {
            handled: true,
            responseContent:
                `TypeAgent PowerShell guidance switched **${setting}**.` +
                (setting === "on"
                    ? "  \nPowerShell commands will be guided toward TypeAgent PowerShell for reusability."
                    : "  \nPowerShell commands will execute directly without TypeAgent PowerShell guidance."),
            handledBy: "typeagent",
        };
    }

    // @typeagent status
    if (lower === "@typeagent status" || lower === "@typeagent") {
        const mode = getMode();
        const host = process.env.TYPEAGENT_HOST || "localhost";
        const port = process.env.TYPEAGENT_PORT || "8999";
        const configPath = getConfigPath();
        const config = readConfig();
        const powershellEnabled = config?.powershell?.enabled ?? true;

        return {
            handled: true,
            responseContent: [
                "**TypeAgent Configuration**",
                "",
                `- Mode: **${mode}**`,
                `- TypeAgent PowerShell: **${powershellEnabled ? "on" : "off"}**`,
                `- Macro workspace tools: **${mode === "bypass" ? "disabled" : "available"}**`,
                `- Server: ws://${host}:${port}`,
                `- Config: ${configPath}`,
                "",
                "**Commands:**",
                "- `@typeagent run <command>` — send command directly to TypeAgent",
                "- `@typeagent mode direct` — switch to direct mode",
                "- `@typeagent mode mcp` — switch to MCP mode",
                "- `@typeagent mode dev` — route registered PowerShell flows and recording directives",
                "- `@typeagent mode bypass` — disable TypeAgent routing",
                "- `@typeagent powershell on/off` — toggle TypeAgent PowerShell redirect",
                "- `@typeagent status` — show this info",
            ].join("  \n"),
            handledBy: "typeagent",
        };
    }

    // @typeagent <anything else> — treat as a direct TypeAgent command
    const catchAll = trimmed.match(/^@typeagent\s+(.+)$/i);
    if (catchAll) {
        const command = catchAll[1];
        return handleDirect({
            prompt: command,
            sessionId: "",
            timestamp: 0,
            cwd: "",
        });
    }

    return undefined;
}

async function main(): Promise<void> {
    const abortController = new AbortController();
    const abortRequest = () => abortController.abort();
    process.once("SIGINT", abortRequest);
    process.once("SIGTERM", abortRequest);

    try {
        let inputData = "";
        process.stdin.setEncoding("utf8");

        for await (const chunk of process.stdin) {
            inputData += chunk;
        }

        let input: HookInput;
        try {
            input = JSON.parse(inputData);
        } catch {
            console.error("Failed to parse hook input");
            process.exit(1);
        }

        // Check for slash commands first
        const slashResult = await handleSlashCommand(input.prompt);
        if (slashResult) {
            console.log(JSON.stringify(slashResult));
            emitDemoStateForOutput(input, slashResult, "direct");
            return;
        }

        // Route based on current mode
        const mode = getMode();
        let output: HookOutput;

        if (mode === "bypass") {
            // Bypass mode: return empty to fall through to other handlers
            output = {};
        } else if (mode === "mcp") {
            output = handleMcpRedirect(input);
        } else if (mode === "dev") {
            output = await handleDevActions(
                input,
                undefined,
                abortController.signal,
            );
        } else {
            output = await handleDirect(input);
        }

        console.log(JSON.stringify(output));
        emitDemoStateForOutput(input, output, mode);
    } finally {
        process.removeListener("SIGINT", abortRequest);
        process.removeListener("SIGTERM", abortRequest);
    }
}

/**
 * If the router fully handled the request (returned handled: true), write
 * the demo state file with the response text. In MCP-redirect mode the LLM
 * still runs after we return — the actual end-of-turn is signaled by
 * hook-agent-stop, so we don't write state here for that case.
 */
function emitDemoStateForOutput(
    input: HookInput,
    output: HookOutput,
    mode: Mode,
): void {
    if (!output.handled) return;
    writeDemoState({
        event: "turnComplete",
        turnId: makeTurnId(input.sessionId),
        ts: Date.now(),
        mode: mode === "mcp" ? "mcp" : "direct",
        handledBy: output.handledBy === "typeagent" ? "typeagent" : "copilot",
        lastResponse: output.responseContent ?? "",
        sessionId: input.sessionId,
    });
}

main().catch((error) => {
    console.error("Hook error:", error);
    process.exit(1);
});
