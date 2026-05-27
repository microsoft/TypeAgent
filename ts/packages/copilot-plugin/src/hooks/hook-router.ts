// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Hook entry point that routes to the appropriate handler based on configuration.
 *
 * Mode selection (in priority order):
 * 1. TYPEAGENT_MODE environment variable ("direct" | "mcp")
 * 2. Config file at <configDir>/config.json
 * 3. Default: "direct"
 *
 * Slash commands (intercepted before routing):
 *   @typeagent mode direct   — switch to direct mode
 *   @typeagent mode mcp      — switch to MCP mode
 *   @typeagent mode          — show current mode
 *   @typeagent status        — show current configuration
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { handleDirect } from "./hook-direct.js";
import { handleMcpRedirect } from "./hook-mcp-redirect.js";
import { makeTurnId, writeDemoState } from "./demo-state.js";
import type { HookInput, HookOutput } from "./types.js";

type Mode = "direct" | "mcp";

interface PluginConfig {
    mode: Mode;
    powershell?: {
        enabled?: boolean;
    };
    [key: string]: unknown;
}

function getConfigDir(): string {
    return (
        process.env.TYPEAGENT_PLUGIN_DATA ??
        process.env.CLAUDE_PLUGIN_DATA ??
        join(homedir(), ".typeagent-copilot")
    );
}

function getConfigPath(): string {
    return join(getConfigDir(), "config.json");
}

function readConfig(): PluginConfig | undefined {
    try {
        return JSON.parse(readFileSync(getConfigPath(), "utf-8"));
    } catch {
        return undefined;
    }
}

function writeConfig(config: PluginConfig): void {
    const dir = getConfigDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n");
}

function getMode(): Mode {
    const envMode = process.env.TYPEAGENT_MODE;
    if (envMode === "direct" || envMode === "mcp") {
        return envMode;
    }
    const config = readConfig();
    if (config?.mode === "direct" || config?.mode === "mcp") {
        return config.mode;
    }
    return "direct";
}

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

    // @typeagent mode <direct|mcp>
    const modeMatch = lower.match(/^@typeagent\s+mode(?:\s+(direct|mcp))?\s*$/);
    if (modeMatch) {
        const newMode = modeMatch[1] as Mode | undefined;

        if (!newMode) {
            // Show current mode
            const current = getMode();
            return {
                handled: true,
                responseContent: `TypeAgent mode: **${current}**\n\nUse \`@typeagent mode direct\` or \`@typeagent mode mcp\` to switch.`,
                handledBy: "typeagent",
            };
        }

        const config = readConfig() ?? { mode: "direct" };
        config.mode = newMode;
        writeConfig(config);

        const description =
            newMode === "direct"
                ? "Hook handles requests directly, bypassing the LLM. Fastest response."
                : "Hook redirects to MCP tool. LLM calls TypeAgent with streaming display.";

        return {
            handled: true,
            responseContent: `TypeAgent mode switched to **${newMode}**.  \n${description}`,
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
                `- Server: ws://${host}:${port}`,
                `- Config: ${configPath}`,
                "",
                "**Commands:**",
                "- `@typeagent run <command>` — send command directly to TypeAgent",
                "- `@typeagent mode direct` — switch to direct mode",
                "- `@typeagent mode mcp` — switch to MCP mode",
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

    if (mode === "mcp") {
        output = handleMcpRedirect(input);
    } else {
        output = await handleDirect(input);
    }

    console.log(JSON.stringify(output));
    emitDemoStateForOutput(input, output, mode);
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
        handledBy: (output.handledBy === "typeagent") ? "typeagent" : "copilot",
        lastResponse: output.responseContent ?? "",
        sessionId: input.sessionId,
    });
}

main().catch((error) => {
    console.error("Hook error:", error);
    process.exit(1);
});
