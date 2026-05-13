// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * preToolUse hook for TypeAgent PowerShell integration.
 * When the LLM uses the powershell tool on Windows, injects context
 * encouraging use of TypeAgent's PowerShell agent for reusability.
 */

interface PreToolInput {
    sessionId: string;
    timestamp: number;
    cwd: string;
    toolName: string;
    toolArgs: unknown;
}

interface PreToolOutput {
    permissionDecision?: "allow" | "deny" | "ask";
    permissionDecisionReason?: string;
    modifiedArgs?: unknown;
    additionalContext?: string;
    suppressOutput?: boolean;
}

// Dev tool commands that don't benefit from TypeAgent PowerShell flows
const PASSTHROUGH_COMMANDS = new Set([
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

function isDevToolCommand(command: string): boolean {
    const firstWord = command.trim().split(/\s+/)[0].toLowerCase();
    return PASSTHROUGH_COMMANDS.has(firstWord);
}

function getPowerShellGuidance(command: string): string {
    return [
        "# TypeAgent PowerShell Integration",
        "",
        "Consider using typeagent-processCommand instead of direct PowerShell for this operation.",
        "TypeAgent's PowerShell agent creates reusable flows that can be invoked by natural language in future sessions.",
        "",
        `Current PowerShell command: ${command.substring(0, 200)}`,
        "",
        "IMPORTANT: When calling typeagent-processCommand, pass the user's ORIGINAL NATURAL LANGUAGE request.",
        "Do NOT pass PowerShell commands or cmdlets — TypeAgent handles the translation internally.",
        "Example: if the user said 'list files in downloads', pass exactly that, not 'Get-ChildItem'.",
        "",
        "Display the tool result in FULL — do NOT summarize, truncate, or paraphrase it.",
    ].join("\n");
}

async function main(): Promise<void> {
    let inputData = "";
    process.stdin.setEncoding("utf8");

    for await (const chunk of process.stdin) {
        inputData += chunk;
    }

    let input: PreToolInput;
    try {
        input = JSON.parse(inputData);
    } catch {
        console.error("[powershell-hook] Failed to parse input");
        process.exit(1);
    }

    let output: PreToolOutput = {};

    // Only intercept the powershell tool
    if (input.toolName === "powershell") {
        const args = input.toolArgs as { command?: string };
        if (args?.command && !isDevToolCommand(args.command)) {
            console.error(
                `[powershell-hook] Injecting TypeAgent PowerShell guidance for: ${args.command.substring(0, 100)}`,
            );
            output = {
                additionalContext: getPowerShellGuidance(args.command),
            };
        }
    }

    console.log(JSON.stringify(output));
}

main().catch((error) => {
    console.error(`[powershell-hook] error: ${error}`);
    console.log("{}");
});
