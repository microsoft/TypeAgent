// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AgentStopOutput,
    BaseHookInput,
    SessionStartOutput,
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

// Copilot CLI hooks. Each reads its JSON payload on stdin, logs the
// session id, and writes `{}` (change nothing). Placeholder until story
// capture exists. Example: `git story hooks copilot session-start`.
const COPILOT_HOOKS = [
    ["user-prompt-submitted", "userPromptSubmitted"],
    ["session-start", "sessionStart"],
    ["agent-stop", "agentStop"],
] as const;

const copilotCommand = hooksCommand
    .command("copilot")
    .description("Copilot CLI hook handlers");

for (const [command, hook] of COPILOT_HOOKS) {
    copilotCommand
        .command(command)
        .description(`Handle the Copilot ${hook} hook`)
        .action(async () => {
            // Empty stdin (manual run) is treated as `{}`.
            const input = JSON.parse(
                (await readStdin()) || "{}",
            ) as Partial<BaseHookInput>;
            const output:
                | UserPromptSubmittedOutput
                | SessionStartOutput
                | AgentStopOutput = {};
            process.stderr.write(
                `git-story ${hook}: session=${input.sessionId}\n`,
            );
            cliLogger.info(`${hook} session=${input.sessionId}`);
            process.stdout.write(`${JSON.stringify(output)}\n`);
        });
}

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
