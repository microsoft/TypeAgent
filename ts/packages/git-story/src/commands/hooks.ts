// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AgentStopOutput,
    BaseHookInput,
    SessionStartInput,
    SessionStartOutput,
    UserPromptSubmittedOutput,
} from "@typeagent/agent-harness-hooks/copilot-cli";
import { Command } from "commander";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { daemonClient } from "../daemonClient.js";
import { cliLogger } from "../logger.js";
import type { SessionRegistration } from "../sessionWatcher.js";

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
async function readCopilotInput<T extends BaseHookInput>(
    hook: string,
): Promise<Partial<T>> {
    const input = JSON.parse((await readStdin()) || "{}") as Partial<T>;
    process.stderr.write(`git-story ${hook}: session=${input.sessionId}\n`);
    cliLogger.info(`${hook} session=${input.sessionId}`);
    return input;
}

const COPILOT_CLIENT_NAME = "copilot-cli";

// Repository root containing `cwd`. Example: "/repo/src" -> "/repo".
function projectPath(cwd: string): string {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        encoding: "utf8",
        windowsHide: true,
    }).trim();
    return path.resolve(root);
}

// Builds the daemon registration for a Copilot sessionStart payload.
// Example: {sessionId:"s7", cwd:"/repo/src"} ->
//   {projectPath:"/repo", sessionId:"s7",
//    metadata:{clientName:"copilot-cli", models:[]}}
function sessionRegistration(
    input: Pick<SessionStartInput, "sessionId" | "cwd">,
): SessionRegistration {
    return {
        projectPath: projectPath(input.cwd),
        sessionId: input.sessionId,
        metadata: { clientName: COPILOT_CLIENT_NAME, models: [] },
    };
}

// Registers the session with the daemon. Never throws: a missing daemon,
// non-git cwd, or timeout is logged and ignored so the agent is unaffected.
async function registerSession(
    build: () => SessionRegistration,
): Promise<void> {
    try {
        const body = build();
        await daemonClient.registerSession(body);
        cliLogger.info(`sessionStart registered: ${body.sessionId}`);
    } catch (e) {
        cliLogger.info(`sessionStart not registered: ${(e as Error).message}`);
    }
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
        const input = await readCopilotInput<SessionStartInput>("sessionStart");
        await registerSession(() =>
            sessionRegistration(input as SessionStartInput),
        );
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

const VSCODE_CLIENT_NAME = "vscode-copilot";

// VS Code agent hook stdin fields used here (snake_case; session_id and
// transcript_path are optional). VS Code runs the hook in the workspace
// folder, so `cwd` is only present when the hook entry sets one.
// See https://code.visualstudio.com/docs/copilot/customization/hooks
type VSCodeHookInput = {
    hook_event_name: string;
    session_id?: string;
    transcript_path?: string;
    cwd?: string;
};

// Builds the daemon registration for a VS Code SessionStart payload. VS Code
// passes the transcript path, so it is sent as-is.
// Example: {session_id:"s7", transcript_path:"/ws/transcripts/s7.jsonl"} ->
//   {projectPath:"/repo", sessionId:"s7",
//    transcriptPath:"/ws/transcripts/s7.jsonl",
//    metadata:{clientName:"vscode-copilot", models:[]}}
export function vscodeSessionRegistration(
    input: VSCodeHookInput,
    cwd: string,
): SessionRegistration {
    return {
        projectPath: projectPath(input.cwd ?? cwd),
        sessionId: input.session_id ?? "",
        transcriptPath: input.transcript_path,
        metadata: { clientName: VSCODE_CLIENT_NAME, models: [] },
    };
}

// VS Code Copilot agent hooks. Example: `git story hooks vscode session-start`.
// Writes `{}` (change nothing).
hooksCommand
    .command("vscode")
    .description("VS Code Copilot hook handlers")
    .command("session-start")
    .description("Handle the VS Code SessionStart hook")
    .action(async () => {
        const input = JSON.parse(
            (await readStdin()) || "{}",
        ) as VSCodeHookInput;
        cliLogger.info(`vscode SessionStart session=${input.session_id}`);
        await registerSession(() =>
            vscodeSessionRegistration(input, process.cwd()),
        );
        process.stdout.write("{}\n");
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
