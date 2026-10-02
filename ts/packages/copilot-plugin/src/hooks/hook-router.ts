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
 *   @typeagent mode mcp mixed - let Copilot choose delegation or orchestration
 *   @typeagent mode          — show current mode
 *   @typeagent status        — show current configuration
 */

import { handleDirect, type DirectHandlingOptions } from "./hook-direct.js";
import { handleMcpRedirect } from "./hook-mcp-redirect.js";
import { handleDevActions } from "./hook-dev-actions.js";
import { makeTurnId, writeDemoState } from "./demo-state.js";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type {
    UserPromptSubmittedInput,
    UserPromptSubmittedOutput,
} from "@typeagent/agent-harness-hooks/copilot-cli";
import { connectToAgentServer } from "../shared/typeagent-client.js";
import { redactTraceValue } from "@typeagent/copilot-macros";
import { getMacroFeatures } from "../shared/macro-features.js";
import {
    getConfigPath,
    getMode,
    getModeLabel,
    readConfig,
    writeConfig,
    type Mode,
} from "../shared/plugin-config.js";
import {
    getModeDescription,
    handleModeSetting,
} from "../shared/mode-command.js";
import { cancelMacroWork, learningSetting } from "../shared/macro-learning.js";

async function handleMacroCommand(
    input: UserPromptSubmittedInput,
    lower: string,
): Promise<UserPromptSubmittedOutput | undefined> {
    const learning = lower.match(/^@typeagent\s+macro\s+learning(?:\s+(.+))?$/);
    if (learning) {
        return {
            handled: true,
            responseContent: await learningSetting(input.cwd, learning[1]),
            handledBy: "typeagent",
        };
    }
    const match = lower.match(
        /^@typeagent\s+macro\s+(record|cancel|status)\s*$/,
    );
    if (!match) return undefined;

    const command = match[1];
    if (command === "cancel") {
        return {
            handled: true,
            responseContent: await cancelMacroWork(input.sessionId),
            handledBy: "typeagent",
        };
    }
    const connection = await connectToAgentServer();
    try {
        if (command === "record") {
            const token = await connection.armMacroRecording({
                sessionId: input.sessionId,
                cwd: input.cwd,
                learning: true,
            });
            return {
                handled: true,
                responseContent: `Macro recording armed for the next interaction. Recording token: \`${token.id}\``,
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
            responseContent: `Macro recording status: **${state.status}**.${detail}${
                state.learningJob
                    ? ` Learning: **${state.learningJob.status}** (${state.learningJob.jobId}).${
                          state.learningJob.macro
                              ? ` Macro: ${state.learningJob.macro.macroId}, version ${state.learningJob.macro.version}.`
                              : ""
                      }${state.learningJob.error ? ` ${state.learningJob.error}` : ""}`
                    : ""
            }`,
            handledBy: "typeagent",
        };
    } finally {
        await connection.close();
    }
}

export type DirectHandler = (
    input: UserPromptSubmittedInput,
    options?: DirectHandlingOptions,
) => Promise<UserPromptSubmittedOutput>;

export interface SlashCommandDependencies {
    direct: DirectHandler;
}

const slashCommandDefaults: SlashCommandDependencies = {
    direct: handleDirect,
};

function directCommand(
    input: UserPromptSubmittedInput,
    command: string,
    direct: DirectHandler,
    options?: DirectHandlingOptions,
): Promise<UserPromptSubmittedOutput> {
    return direct(
        {
            prompt: command,
            sessionId: input.sessionId,
            timestamp: input.timestamp,
            cwd: input.cwd,
        },
        options,
    );
}

function handleRunCommand(
    input: UserPromptSubmittedInput,
    trimmed: string,
    direct: DirectHandler,
): Promise<UserPromptSubmittedOutput> | undefined {
    const match = trimmed.match(/^@typeagent\s+run\s+(.+)$/i);
    return match
        ? directCommand(input, match[1], direct, { forceHandled: true })
        : undefined;
}

function handleModeCommand(
    lower: string,
): UserPromptSubmittedOutput | undefined {
    const match = lower.match(/^@typeagent\s+mode(?:\s+(.*))?$/s);
    if (!match) return undefined;
    return {
        handled: true,
        responseContent: handleModeSetting(match[1] ?? "", "@typeagent mode"),
        handledBy: "typeagent",
    };
}

function handlePowerShellCommand(
    lower: string,
): UserPromptSubmittedOutput | undefined {
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

function handleStatusCommand(
    lower: string,
): UserPromptSubmittedOutput | undefined {
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
            `- Mode: **${getModeLabel()}**`,
            `- Routing: ${getModeDescription()}`,
            `- TypeAgent PowerShell: **${powershellEnabled ? "on" : "off"}**`,
            `- Macro workspace tools: **${mode === "bypass" ? "disabled" : "available"}**`,
            `- Server: ws://${host}:${port}`,
            `- Config: ${configPath}`,
            "- Mode settings are shared by sessions using this config.",
            "",
            "**Commands:**",
            "- `@typeagent run <command>` — send command directly to TypeAgent",
            "- `@typeagent mode direct` — switch to direct mode",
            "- `@typeagent mode mcp` — switch to MCP mode, preserving saved policy (default: delegate)",
            "- `@typeagent mode mcp mixed` — delegate whole requests or prefer TypeAgent searchActions/executeAction for Copilot-selected operations; native tools only for capability gaps",
            "- `@typeagent mode mcp delegate` — delegate user prompts to TypeAgent (default)",
            "- `@typeagent mode dev` — route registered PowerShell flows and recording directives",
            "- `@typeagent mode bypass` — disable TypeAgent routing",
            "- `@typeagent powershell on/off` — toggle TypeAgent PowerShell redirect",
            "- `@typeagent status` — show this info",
        ].join("  \n"),
        handledBy: "typeagent",
    };
}

function handleCatchAllCommand(
    input: UserPromptSubmittedInput,
    trimmed: string,
    direct: DirectHandler,
): Promise<UserPromptSubmittedOutput> | undefined {
    const match = trimmed.match(/^@typeagent\s+(.+)$/i);
    return match ? directCommand(input, match[1], direct) : undefined;
}

/**
 * Handle @typeagent slash commands. Returns a UserPromptSubmittedOutput if the command
 * was handled, or undefined if the prompt is not a slash command.
 * Returns a Promise for commands that need async work (e.g., @typeagent run).
 */
export async function handleSlashCommand(
    input: UserPromptSubmittedInput,
    dependencies: SlashCommandDependencies = slashCommandDefaults,
): Promise<UserPromptSubmittedOutput | undefined> {
    const trimmed = input.prompt.trim();
    const lower = trimmed.toLowerCase();

    return (
        (await handleMacroCommand(input, lower)) ??
        handleRunCommand(input, trimmed, dependencies.direct) ??
        handleModeCommand(lower) ??
        handlePowerShellCommand(lower) ??
        handleStatusCommand(lower) ??
        handleCatchAllCommand(input, trimmed, dependencies.direct)
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

        let input: UserPromptSubmittedInput;
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
    claimRecording: (input: UserPromptSubmittedInput) => Promise<boolean>;
    direct: DirectHandler;
    mcp: (input: UserPromptSubmittedInput) => UserPromptSubmittedOutput;
    dev: (
        input: UserPromptSubmittedInput,
        signal: AbortSignal,
    ) => Promise<UserPromptSubmittedOutput>;
}

const routePromptDefaults: RoutePromptDependencies = {
    claimRecording: claimMacroRecording,
    direct: handleDirect,
    mcp: handleMcpRedirect,
    dev: (input, signal) => handleDevActions(input, undefined, signal),
};

export async function routePrompt(
    input: UserPromptSubmittedInput,
    mode: Mode,
    signal: AbortSignal,
    dependencies: RoutePromptDependencies = routePromptDefaults,
): Promise<UserPromptSubmittedOutput> {
    if (mode === "bypass") return {};
    if (await dependencies.claimRecording(input)) return {};
    if (mode === "mcp") return dependencies.mcp(input);
    if (mode === "dev") return dependencies.dev(input, signal);
    return dependencies.direct(input);
}

async function claimMacroRecording(
    input: UserPromptSubmittedInput,
): Promise<boolean> {
    if (!getMacroFeatures().recording) return false;
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
    input: UserPromptSubmittedInput,
    output: UserPromptSubmittedOutput,
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
