// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AgentStopOutput,
    BaseHookInput,
    SessionStartOutput,
    UserPromptSubmittedOutput,
} from "@typeagent/agent-harness-hooks/copilot-cli";
import { Command } from "commander";
import fs from "node:fs";
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

// Reads a Copilot hook payload and logs its session id.
// Empty stdin (manual run) is treated as `{}`.
async function readCopilotInput(hook: string): Promise<Partial<BaseHookInput>> {
    const input = JSON.parse(
        (await readStdin()) || "{}",
    ) as Partial<BaseHookInput>;
    process.stderr.write(`git-story ${hook}: session=${input.sessionId}\n`);
    cliLogger.info(`${hook} session=${input.sessionId}`);
    return input;
}

// Copilot CLI hooks. Each writes `{}` (change nothing). Placeholder until
// story capture exists. Example: `git story hooks copilot session-start`.
const copilotCommand = hooksCommand
    .command("copilot")
    .description("Copilot CLI hook handlers");

copilotCommand
    .command("user-prompt-submitted")
    .description("Handle the Copilot userPromptSubmitted hook")
    .action(async () => {
        await readCopilotInput("userPromptSubmitted");
        const output: UserPromptSubmittedOutput = {};
        process.stdout.write(`${JSON.stringify(output)}\n`);
    });

copilotCommand
    .command("session-start")
    .description("Handle the Copilot sessionStart hook")
    .action(async () => {
        await readCopilotInput("sessionStart");
        const output: SessionStartOutput = {};
        process.stdout.write(`${JSON.stringify(output)}\n`);
    });

copilotCommand
    .command("agent-stop")
    .description("Handle the Copilot agentStop hook")
    .action(async () => {
        await readCopilotInput("agentStop");
        const output: AgentStopOutput = {};
        process.stdout.write(`${JSON.stringify(output)}\n`);
    });

// `hooks git <hook> [args...]`: called by the scripts `init` writes to the
// git hooks directory. Git's hook args and stdin are forwarded as-is.
// Example: `git story hooks git pre-commit` with empty stdin.
const gitCommand = hooksCommand.command("git").description("Git hook handlers");

gitCommand
    .command("pre-commit")
    .description("Handle the git pre-commit hook")
    .argument("[args...]", "arguments git passed to the hook")
    .action(async (args: string[]) => {
        const input = await readStdin();
        const message = `git-story pre-commit: args=${JSON.stringify(args)} stdin=${JSON.stringify(input)}`;
        process.stdout.write(`${message}\n`);
        cliLogger.info(message);
    });

// Trailer appended to each commit message.
// TODO: replace with the git-story summary for the commit.
const COMMIT_TRAILER = "typeagent";

// `hooks git prepare-commit-msg <file> [source] [sha]`: git passes the path
// of the message file. Appends COMMIT_TRAILER once, so amends and retries do
// not repeat it. Example: "fix bug\n" -> "fix bug\n\ntypeagent\n".
gitCommand
    .command("prepare-commit-msg")
    .description("Handle the git prepare-commit-msg hook")
    .argument("<file>", "commit message file")
    .argument("[args...]", "message source and commit sha")
    .action((file: string) => {
        const message = fs.readFileSync(file, "utf8");
        if (message.split("\n").includes(COMMIT_TRAILER)) return;
        fs.writeFileSync(file, `${message.trimEnd()}\n\n${COMMIT_TRAILER}\n`);
        cliLogger.info(`prepare-commit-msg: appended trailer to ${file}`);
    });
