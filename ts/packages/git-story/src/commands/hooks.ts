// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    UserPromptSubmittedInput,
    UserPromptSubmittedOutput,
} from "@typeagent/agent-harness-hooks/copilot-cli";
import { Command } from "commander";
import { cliLogger } from "../logger.js";

// Reads all of stdin. Hooks get their payload here (Copilot JSON, or lines
// git pipes to hooks such as pre-push). Returns "" when stdin is a terminal.
async function readStdin(): Promise<string> {
    if (process.stdin.isTTY) return "";
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
}

// `hooks`: agent and git hook handlers. Placeholder output until story
// capture exists.
export const hooksCommand = new Command("hooks").description(
    "Agent and git hook handlers",
);

hooksCommand
    .command("copilot")
    .description("Copilot CLI hook handlers")
    .command("user-prompt-submitted")
    .description("Handle the Copilot userPromptSubmitted hook")
    .action(async () => {
        // Placeholder: parse the payload, change nothing.
        const input = JSON.parse(await readStdin()) as UserPromptSubmittedInput;
        const output: UserPromptSubmittedOutput = {};
        process.stderr.write(`git-story prompt: session=${input.sessionId}\n`);
        cliLogger.info(`prompt session=${input.sessionId}`);
        process.stdout.write(`${JSON.stringify(output)}\n`);
    });

// `hooks git <hook> [args...]`: called by the scripts `init` writes to the
// git hooks directory. Git's hook args and stdin are forwarded as-is.
// Example: `git story hooks git pre-commit` with empty stdin.
hooksCommand
    .command("git")
    .description("Git hook handlers")
    .command("pre-commit")
    .description("Handle the git pre-commit hook")
    .argument("[args...]", "arguments git passed to the hook")
    .action(async (args: string[]) => {
        const input = await readStdin();
        const message = `git-story pre-commit: args=${JSON.stringify(args)} stdin=${JSON.stringify(input)}`;
        process.stdout.write(`${message}\n`);
        cliLogger.info(message);
    });
