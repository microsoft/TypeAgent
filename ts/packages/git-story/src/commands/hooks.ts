// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AgentStopOutput,
    BaseHookInput,
    SessionStartInput,
    SessionStartOutput,
    UserPromptSubmittedOutput,
} from "@typeagent/agent-harness-hooks/copilot-cli";
import { Argument, Command } from "commander";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SessionIdSchema } from "../daemonApi.js";
import { daemonClient } from "../daemonClient.js";
import { cliLogger } from "../logger.js";
import type { SessionRegistration } from "../sessionWatcher.js";
import { StoryAggregator } from "../storyAggregator.js";

// Reads all of stdin. Hooks get their payload here (Copilot JSON, or lines
// git pipes to hooks such as pre-push). Returns "" when stdin is a terminal.
async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    await consumeStdin((buffer) => {
        bytes += buffer.length;
        if (bytes > 64 * 1024) throw new Error("Hook input too large");
        chunks.push(buffer);
    });
    return Buffer.concat(chunks).toString("utf8");
}

async function consumeStdin(onChunk: (buffer: Buffer) => void): Promise<void> {
    if (process.stdin.isTTY) return;
    const timer = setTimeout(
        () => process.stdin.destroy(new Error("Hook input timed out")),
        2000,
    );
    try {
        for await (const chunk of process.stdin) {
            onChunk(Buffer.from(chunk));
        }
    } finally {
        clearTimeout(timer);
    }
}

// `hooks`: agent and git hook handlers. Placeholder output until story
// capture exists.
export const hooksCommand = new Command("hooks").description(
    "Agent and git hook handlers",
);

const HookIdentitySchema = z.object({
    sessionId: SessionIdSchema,
    cwd: z.string().refine(path.isAbsolute),
    timestamp: z.number().finite().nonnegative(),
});

// Hook errors must not block the agent or echo untrusted input.
async function readCopilotInput(
    hook: string,
): Promise<BaseHookInput | undefined> {
    try {
        return HookIdentitySchema.parse(JSON.parse(await readStdin()));
    } catch {
        process.stderr.write(`git-story ${hook}: invalid input ignored\n`);
        cliLogger.warn(`${hook}: invalid input ignored`);
        return undefined;
    }
}

const COPILOT_CLIENT_NAME = "copilot-cli";

// Repository root containing `cwd`. Example: "/repo/src" -> "/repo".
function projectPath(cwd: string): string {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        timeout: 1000,
        stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return path.resolve(root);
}

type StoryAggregatorLike = Pick<StoryAggregator, "aggregate">;

// Runs aggregation at the repository's current HEAD. Post hooks must not make
// a completed git operation look unsuccessful, so failures are logged only.
export async function aggregateStoriesAfterGitChange(
    hook: string,
    cwd: string,
    aggregator: StoryAggregatorLike = new StoryAggregator(),
): Promise<void> {
    try {
        const root = projectPath(cwd);
        await aggregator.aggregate({
            projectPath: root,
            revision: "HEAD",
        });
        cliLogger.info(`${hook}: story aggregation completed`);
    } catch (e) {
        cliLogger.warn(
            `${hook}: story aggregation not completed: ${(e as Error).message}`,
        );
    }
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
        const receipt = await daemonClient.registerSession(body);
        process.stderr.write(`git-story sessionStart: ${receipt.state}\n`);
        cliLogger.info(`sessionStart: ${receipt.state}`);
    } catch {
        process.stderr.write(
            "git-story sessionStart: registration unavailable; agent continues\n",
        );
        cliLogger.warn(
            "sessionStart: registration unavailable; agent continues",
        );
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
        const input = await readCopilotInput("sessionStart");
        if (input) await registerSession(() => sessionRegistration(input));
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
const VSCodeHookSchema = z.object({
    hook_event_name: z.literal("SessionStart"),
    session_id: SessionIdSchema.optional(),
    transcript_path: z.string().refine(path.isAbsolute).optional(),
    cwd: z.string().refine(path.isAbsolute).optional(),
});
type VSCodeHookInput = z.infer<typeof VSCodeHookSchema>;

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
        try {
            const input = VSCodeHookSchema.parse(JSON.parse(await readStdin()));
            await registerSession(() =>
                vscodeSessionRegistration(input, process.cwd()),
            );
            process.stderr.write(
                "git-story vscode: native transcript capture is not supported; agent continues\n",
            );
        } catch {
            process.stderr.write("git-story vscode: invalid input ignored\n");
            cliLogger.warn("vscode SessionStart: invalid input ignored");
        }
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
        await readStdin();
        const message = `git-story pre-commit: received ${args.length} arguments`;
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

gitCommand
    .command("post-commit")
    .description("Aggregate stories after a git commit")
    .action(async () => {
        await aggregateStoriesAfterGitChange("post-commit", process.cwd());
    });

gitCommand
    .command("post-merge")
    .description("Aggregate stories after a merge or non-rebase pull")
    .argument("[squash]", "whether the merge was a squash merge")
    .action(async () => {
        await aggregateStoriesAfterGitChange("post-merge", process.cwd());
    });

gitCommand
    .command("post-rewrite")
    .description("Aggregate stories after a rebase")
    .argument("<command>", "command that rewrote commits")
    .action(async (command: string) => {
        try {
            await consumeStdin(() => {});
        } catch {
            cliLogger.warn(
                "post-rewrite: failed to drain stdin; continuing without rewrite input",
            );
        }
        if (command !== "rebase") return;
        await aggregateStoriesAfterGitChange("post-rewrite", process.cwd());
    });

gitCommand
    .command("post-checkout")
    .description("Aggregate stories after a branch checkout or switch")
    .argument("<previous-head>", "previous HEAD")
    .argument("<new-head>", "new HEAD")
    .addArgument(
        new Argument(
            "<flag>",
            "1 for branch checkout; 0 for file checkout",
        ).choices(["0", "1"]),
    )
    .action(async (_previousHead: string, _newHead: string, flag: string) => {
        if (flag === "0") return;
        await aggregateStoriesAfterGitChange("post-checkout", process.cwd());
    });
