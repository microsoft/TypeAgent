// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AgentStopOutput,
    BaseHookInput,
    PostToolUseFailureOutput,
    PostToolUseOutput,
    PreToolUseOutput,
    SessionEndOutput,
    SessionStartOutput,
    UserPromptSubmittedOutput,
} from "@typeagent/agent-harness-hooks/copilot-cli";
import { Command } from "commander";
import fs from "node:fs";
import type { CopilotHookName } from "../hookRecorder.js";
import { recordCopilotHook } from "../hookRecorder.js";
import { cliLogger } from "../logger.js";
import { findRepository, resolveGitDirectory, runGit } from "../git.js";
import { JsonlSessionStore } from "../sessionStore.js";
import { StoryBuilder } from "../storyBuilder.js";

async function readStdin(): Promise<string> {
    if (process.stdin.isTTY) return "";
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
}

export const hooksCommand = new Command("hooks").description(
    "Agent and git hook handlers",
);

async function readCopilotInput(
    hook: CopilotHookName,
): Promise<Partial<BaseHookInput> & Record<string, unknown>> {
    const input = JSON.parse(
        (await readStdin()) || "{}",
    ) as Partial<BaseHookInput> & Record<string, unknown>;
    recordCopilotHook(hook, input);
    cliLogger.info(`${hook} session=${input.sessionId}`);
    return input;
}

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
    .command("pre-tool-use")
    .description("Handle the Copilot preToolUse hook")
    .action(async () => {
        await readCopilotInput("preToolUse");
        const output: PreToolUseOutput = {};
        process.stdout.write(`${JSON.stringify(output)}\n`);
    });

copilotCommand
    .command("post-tool-use")
    .description("Handle the Copilot postToolUse hook")
    .action(async () => {
        await readCopilotInput("postToolUse");
        const output: PostToolUseOutput = {};
        process.stdout.write(`${JSON.stringify(output)}\n`);
    });

copilotCommand
    .command("post-tool-use-failure")
    .description("Handle the Copilot postToolUseFailure hook")
    .action(async () => {
        await readCopilotInput("postToolUseFailure");
        const output: PostToolUseFailureOutput = {};
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

copilotCommand
    .command("session-end")
    .description("Handle the Copilot sessionEnd hook")
    .action(async () => {
        await readCopilotInput("sessionEnd");
        const output: SessionEndOutput = {};
        process.stdout.write(`${JSON.stringify(output)}\n`);
    });

const gitCommand = hooksCommand.command("git").description("Git hook handlers");

gitCommand
    .command("pre-commit")
    .description("Handle the git pre-commit hook")
    .argument("[args...]", "arguments git passed to the hook")
    .action(async (args: string[]) => {
        const input = await readStdin();
        cliLogger.info(
            `pre-commit: args=${JSON.stringify(args)} stdin=${JSON.stringify(input)}`,
        );
    });

gitCommand
    .command("prepare-commit-msg")
    .description("Attach the current story to a commit message")
    .argument("<file>", "commit message file")
    .argument("[args...]", "message source and commit sha")
    .action(async (file: string) => {
        const repository = findRepository(process.cwd());
        if (!repository) return;
        const store = new JsonlSessionStore(resolveGitDirectory(repository));
        const message = fs.readFileSync(file, "utf8");
        const result = await new StoryBuilder().build({
            commit: {
                projectPath: repository,
                diff: runGit(repository, ["diff", "--cached", "--binary"]),
                message,
            },
            store,
        });
        if (!result.story.sessions.length && !result.story.humanOnly.length)
            return;
        fs.writeFileSync(file, result.commitMessage);
        store.writePending(result.sessions);
        cliLogger.info(`prepare-commit-msg: attached story to ${file}`);
    });

gitCommand
    .command("post-commit")
    .description("Advance committed session checkpoints")
    .argument("[args...]", "arguments git passed to the hook")
    .action(() => {
        const repository = findRepository(process.cwd());
        if (!repository) return;
        const store = new JsonlSessionStore(resolveGitDirectory(repository));
        const commit = runGit(repository, ["rev-parse", "HEAD"]);
        for (const { session, count } of store.consumePending()) {
            store.markCommitted(session, commit, count);
        }
    });
