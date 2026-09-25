// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getMode,
    isMixedMcpMode,
    isPowerShellGuidanceEnabled,
} from "../shared/plugin-config.js";
import {
    mcpActionProviderGuidance,
    mixedPowerShellGuidance,
} from "../shared/mcp-guidance.js";

interface PowerShellHookOutput {
    additionalContext: string;
}

const passthroughCommands = new Set([
    "node",
    "npm",
    "npx",
    "pnpm",
    "yarn",
    "git",
    "gh",
    "python",
    "python3",
    "pip",
    "pip3",
    "docker",
    "kubectl",
    "code",
    "copilot",
    "copilot-dev",
    "fnm",
    "nvm",
]);

function commandFromArgs(toolArgs: unknown): string | undefined {
    if (!toolArgs || typeof toolArgs !== "object") return undefined;
    const command = (toolArgs as { command?: unknown }).command;
    return typeof command === "string" ? command : undefined;
}

export function getPowerShellHookOutput(
    toolName: string,
    toolArgs: unknown,
): PowerShellHookOutput | undefined {
    const mode = getMode();
    if (
        mode === "dev" ||
        mode === "bypass" ||
        !isPowerShellGuidanceEnabled() ||
        toolName !== "powershell"
    ) {
        return undefined;
    }

    const command = commandFromArgs(toolArgs);
    const firstWord = command?.trim().split(/\s+/)[0].toLowerCase();
    if (!command) {
        return undefined;
    }

    if (isMixedMcpMode()) {
        return {
            additionalContext: [
                mcpActionProviderGuidance,
                mixedPowerShellGuidance,
            ].join("\n"),
        };
    }
    if (mode === "mcp") {
        return {
            additionalContext: [
                mcpActionProviderGuidance,
                "Use typeagent-processCommand instead of direct PowerShell for the user's intact request under MCP delegate policy.",
                "Pass the user's original natural language, not shell code or a synthetic request for an intermediate step.",
                "Native fallback requires an explicit unsupported-capability result before any action executes, never a generic error or partial result. Recording directives must never fall back to native tools.",
            ].join("\n"),
        };
    }
    if (firstWord && passthroughCommands.has(firstWord)) {
        return undefined;
    }

    return {
        additionalContext: [
            "# TypeAgent PowerShell Integration",
            "",
            "Consider using typeagent-processCommand instead of direct PowerShell for this operation.",
            "TypeAgent's PowerShell agent creates reusable flows that can be invoked by natural language in future sessions.",
            "",
            `Current PowerShell command: ${command.substring(0, 200)}`,
            "",
            "When calling typeagent-processCommand, pass the user's original natural language request, not PowerShell commands or cmdlets.",
            "Display the tool result in full without summarizing or truncating it.",
        ].join("\n"),
    };
}
