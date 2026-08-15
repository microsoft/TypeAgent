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
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { HookInput, HookOutput } from "./types.js";
import { connectToAgentServer } from "../shared/typeagent-client.js";
import { redactTraceValue } from "@typeagent/copilot-macros";
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

async function handleMacroCommand(
    input: HookInput,
    lower: string,
): Promise<HookOutput | undefined> {
    const match = lower.match(
        /^@typeagent\s+macro\s+(record|cancel|status)\s*$/,
    );
    if (!match) return undefined;

    const command = match[1];
    const connection = await connectToAgentServer();
    try {
        if (command === "record") {
            const token = await connection.armMacroRecording({
                sessionId: input.sessionId,
            });
            return {
                handled: true,
                responseContent: `Macro recording armed for the next interaction. Recording token: \`${token.id}\``,
                handledBy: "typeagent",
            };
        }
        if (command === "cancel") {
            await connection.cancelMacroRecording(input.sessionId);
            return {
                handled: true,
                responseContent: "Macro recording cancelled.",
                handledBy: "typeagent",
            };
        }

        const state = await connection.getMacroRecordingState(input.sessionId);
        const detail =
            state.status === "completed" && state.trace
                ? ` Trace ID: \`${state.trace.traceId}\``
                : state.status === "failed" && state.error
                  ? ` ${state.error}`
                  : state.token
                    ? ` Recording token: \`${state.token.id}\``
                    : "";
        return {
            handled: true,
            responseContent: `Macro recording status: **${state.status}**.${detail}`,
            handledBy: "typeagent",
        };
    } finally {
        await connection.close();
    }
}

function directCommand(input: HookInput, command: string): Promise<HookOutput> {
    return handleDirect({
        prompt: command,
        sessionId: input.sessionId,
        timestamp: input.timestamp,
        cwd: input.cwd,
    });
}

function handleRunCommand(
    input: HookInput,
    trimmed: string,
): Promise<HookOutput> | undefined {
    const match = trimmed.match(/^@typeagent\s+run\s+(.+)$/i);
    return match ? directCommand(input, match[1]) : undefined;
}

function handleModeCommand(lower: string): HookOutput | undefined {
    const match = lower.match(
        /^@typeagent\s+mode(?:\s+(direct|mcp|dev|bypass))?\s*$/,
    );
    if (!match) return undefined;

    const newMode = match[1] as Mode | undefined;
    if (!newMode) {
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

function handlePowerShellCommand(lower: string): HookOutput | undefined {
    const match = lower.match(/^@typeagent\s+powershell(?:\s+(on|off))?\s*$/);
    if (!match) return undefined;

    const setting = match[1] as "on" | "off" | undefined;
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

function handleStatusCommand(lower: string): HookOutput | undefined {
    if (lower !== "@typeagent status" && lower !== "@typeagent") {
        return undefined;
    }
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

function handleCatchAllCommand(
    input: HookInput,
    trimmed: string,
): Promise<HookOutput> | undefined {
    const match = trimmed.match(/^@typeagent\s+(.+)$/i);
    return match ? directCommand(input, match[1]) : undefined;
}

/**
 * Handle @typeagent slash commands. Returns a HookOutput if the command
 * was handled, or undefined if the prompt is not a slash command.
 * Returns a Promise for commands that need async work (e.g., @typeagent run).
 */
async function handleSlashCommand(
    input: HookInput,
): Promise<HookOutput | undefined> {
    const trimmed = input.prompt.trim();
    const lower = trimmed.toLowerCase();

    return (
        (await handleMacroCommand(input, lower)) ??
        handleRunCommand(input, trimmed) ??
        handleModeCommand(lower) ??
        handlePowerShellCommand(lower) ??
        handleStatusCommand(lower) ??
        handleCatchAllCommand(input, trimmed)
    );
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
        const slashResult = await handleSlashCommand(input);
        if (slashResult) {
            console.log(JSON.stringify(slashResult));
            emitDemoStateForOutput(input, slashResult, "direct");
            return;
        }

        const mode = getMode();
        const output = await routePrompt(input, mode, abortController.signal);

        console.log(JSON.stringify(output));
        emitDemoStateForOutput(input, output, mode);
    } finally {
        process.removeListener("SIGINT", abortRequest);
        process.removeListener("SIGTERM", abortRequest);
    }
}

export interface RoutePromptDependencies {
    claimRecording: (input: HookInput) => Promise<boolean>;
    direct: (input: HookInput) => Promise<HookOutput>;
    mcp: (input: HookInput) => HookOutput;
    dev: (input: HookInput, signal: AbortSignal) => Promise<HookOutput>;
}

const routePromptDefaults: RoutePromptDependencies = {
    claimRecording: claimMacroRecording,
    direct: handleDirect,
    mcp: handleMcpRedirect,
    dev: (input, signal) => handleDevActions(input, undefined, signal),
};

export async function routePrompt(
    input: HookInput,
    mode: Mode,
    signal: AbortSignal,
    dependencies: RoutePromptDependencies = routePromptDefaults,
): Promise<HookOutput> {
    if (mode === "bypass") return {};
    if (await dependencies.claimRecording(input)) return {};
    if (mode === "mcp") return dependencies.mcp(input);
    if (mode === "dev") return dependencies.dev(input, signal);
    return dependencies.direct(input);
}

async function claimMacroRecording(input: HookInput): Promise<boolean> {
    let connection;
    try {
        connection = await connectToAgentServer();
        const token = await connection.claimMacroRecording({
            sessionId: input.sessionId,
            cwd: input.cwd,
            promptHash: createHash("sha256")
                .update(redactTraceValue(input.prompt) as string)
                .digest("hex"),
        });
        return token !== undefined;
    } catch (error) {
        console.error(
            `[macro] Unable to claim recording: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
    } finally {
        await connection?.close();
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

if (fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error) => {
        console.error("Hook error:", error);
        process.exit(1);
    });
}
