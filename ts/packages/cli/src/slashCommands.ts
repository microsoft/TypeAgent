// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import chalk from "chalk";
import {
    stopAgentServer,
    AGENT_SERVER_DEFAULT_PORT,
} from "@typeagent/agent-server-client";
import type { Dispatcher, QueueSnapshot } from "@typeagent/dispatcher-types";
import type { ConversationCommandContext } from "./conversationCommands.js";
import { handleConversationCommand } from "./conversationCommands.js";

export type SlashCommandHandler = (
    args: string,
    processCommand: (command: string) => Promise<any>,
) => Promise<any>;

interface SlashCommand {
    name: string;
    description: string;
    handler: SlashCommandHandler;
}

// Verbose mode state
let verboseEnabled = false;
let activeNamespaces = "";

export function isVerboseEnabled(): boolean {
    return verboseEnabled;
}

export function enableVerboseFromFlag(namespaces: string): void {
    verboseEnabled = true;
    activeNamespaces = namespaces;
}

// Late-binding context for conversation commands.
// Set from connect.ts after the AgentServerConnection is established.
let conversationContext: ConversationCommandContext | undefined;

export function setConversationCommandContext(
    ctx: ConversationCommandContext,
): void {
    conversationContext = ctx;
}

export function getConversationCommandContext():
    | ConversationCommandContext
    | undefined {
    return conversationContext;
}

// Late-binding server port for shutdown command.
// Set from connect.ts after the connection is established.
let serverPort: number | undefined;
let serverConnection:
    | { shutdown(): Promise<void>; restart(): Promise<void> }
    | undefined;

export function setServerPort(port: number): void {
    serverPort = port;
}

export function getServerPort(): number | undefined {
    return serverPort;
}

export function setServerConnection(
    conn: { shutdown(): Promise<void>; restart(): Promise<void> } | undefined,
): void {
    serverConnection = conn;
}

export function getServerConnection():
    | { shutdown(): Promise<void>; restart(): Promise<void> }
    | undefined {
    return serverConnection;
}

export function getVerboseIndicator(): string {
    if (!verboseEnabled) return "";
    if (activeNamespaces === "typeagent:*")
        return chalk.yellow("[verbose]") + " ";
    const parts = activeNamespaces.split(",");
    if (parts.length === 1) {
        const short = parts[0].replace(/^typeagent:/, "").replace(/:\*$/, "");
        return chalk.yellow(`[verbose:${short}]`) + " ";
    }
    return chalk.yellow(`[verbose:${parts.length} scopes]`) + " ";
}

function handleVerbose(args: string): void {
    if (args === "off" || (args === "" && verboseEnabled)) {
        registerDebug.disable();
        verboseEnabled = false;
        activeNamespaces = "";
        console.log(chalk.dim("Verbose mode disabled."));
    } else {
        const namespaces = args || "typeagent:*";
        registerDebug.enable(namespaces);
        process.env.DEBUG = namespaces;
        verboseEnabled = true;
        activeNamespaces = namespaces;
        console.log(chalk.dim(`Verbose mode enabled: ${namespaces}`));
    }
}

// Late-binding dispatcher accessor for /queue commands; set by connect.ts after joinConversation.
let queueDispatcher: Dispatcher | undefined;

export function setQueueDispatcher(d: Dispatcher | undefined): void {
    queueDispatcher = d;
}

export function getQueueDispatcher(): Dispatcher | undefined {
    return queueDispatcher;
}

function shortId(id: string): string {
    return id.length > 8 ? id.slice(0, 8) : id;
}

function ageMs(start: number): string {
    const ms = Date.now() - start;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m`;
}

function truncateForList(s: string, max = 50): string {
    const single = s.replace(/\s+/g, " ").trim();
    return single.length > max ? single.slice(0, max - 1) + "…" : single;
}

// Local CLI connection id, set by connect.ts after join; used to render `(you)` in /queue list.
let cliConnectionId: string | undefined;

export function setCliConnectionId(id: string | undefined): void {
    cliConnectionId = id;
}

/** Read-only accessor for the CLI's own connection id (or undefined). */
export function getCliConnectionId(): string | undefined {
    return cliConnectionId;
}

function ownerLabel(originatorConnectionId: string | undefined): string {
    if (!originatorConnectionId) return "";
    if (
        cliConnectionId !== undefined &&
        originatorConnectionId === cliConnectionId
    ) {
        return chalk.dim(" (you)");
    }
    // Hash to a short stable label without exposing the raw connection id.
    let h = 0;
    for (let i = 0; i < originatorConnectionId.length; i++) {
        h = (h * 31 + originatorConnectionId.charCodeAt(i)) | 0;
    }
    const tag = (h >>> 0).toString(16).padStart(8, "0").slice(0, 4);
    return chalk.dim(` (client-${tag})`);
}

function formatQueueSnapshot(snap: QueueSnapshot): string {
    const lines: string[] = [];
    lines.push(chalk.bold("Queue:"));
    if (snap.running) {
        const r = snap.running;
        const att =
            r.attachmentCount && r.attachmentCount > 0
                ? chalk.dim(` [${r.attachmentCount} attachments]`)
                : "";
        lines.push(
            `  ${chalk.greenBright("●")} ${chalk.cyan(shortId(r.requestId))} ${chalk.dim("[running " + ageMs(r.startedAt ?? r.submittedAt) + "]")} ${truncateForList(r.text)}${att}${ownerLabel(r.originatorConnectionId)}`,
        );
    } else {
        lines.push(`  ${chalk.dim("(idle)")}`);
    }
    if (snap.queued.length === 0) {
        lines.push(`  ${chalk.dim("(no queued requests)")}`);
    } else {
        // Cap output at 10 entries with a footer for the rest.
        const QUEUE_LIST_DISPLAY_LIMIT = 10;
        const total = snap.queued.length;
        const visible =
            total > QUEUE_LIST_DISPLAY_LIMIT
                ? snap.queued.slice(0, QUEUE_LIST_DISPLAY_LIMIT)
                : snap.queued;
        for (const e of visible) {
            const att =
                e.attachmentCount && e.attachmentCount > 0
                    ? chalk.dim(` [${e.attachmentCount} attachments]`)
                    : "";
            lines.push(
                `  ${chalk.yellow("○")} ${chalk.cyan(shortId(e.requestId))} ${chalk.dim("[queued " + ageMs(e.submittedAt) + "]")} ${truncateForList(e.text)}${att}${ownerLabel(e.originatorConnectionId)}`,
            );
        }
        if (total > QUEUE_LIST_DISPLAY_LIMIT) {
            const hidden = total - QUEUE_LIST_DISPLAY_LIMIT;
            lines.push(
                chalk.dim(
                    `  … and ${hidden} more queued. Use /queue cancel <id> to manage.`,
                ),
            );
        }
    }
    return lines.join("\n");
}

/**
 * Resolve a (possibly short) requestId prefix against the snapshot.
 * Returns the full requestId on a unique match, or an error message.
 */
function resolveRequestIdPrefix(
    prefix: string,
    snap: QueueSnapshot,
): { ok: true; requestId: string } | { ok: false; error: string } {
    if (prefix.length < 4) {
        return {
            ok: false,
            error: "Request id prefix must be at least 4 characters.",
        };
    }
    const candidates: string[] = [];
    if (snap.running && snap.running.requestId.startsWith(prefix)) {
        candidates.push(snap.running.requestId);
    }
    for (const e of snap.queued) {
        if (e.requestId.startsWith(prefix)) candidates.push(e.requestId);
    }
    if (candidates.length === 0) {
        return {
            ok: false,
            error: `No queued or running request matches '${prefix}'.`,
        };
    }
    if (candidates.length > 1) {
        return {
            ok: false,
            error: `Ambiguous prefix '${prefix}': matches ${candidates.length} requests; use a longer prefix.`,
        };
    }
    return { ok: true, requestId: candidates[0] };
}

async function refreshQueueSnapshot(): Promise<QueueSnapshot | undefined> {
    const d = queueDispatcher;
    if (!d || typeof d.getQueueSnapshot !== "function") {
        return undefined;
    }
    try {
        return await d.getQueueSnapshot();
    } catch {
        return undefined;
    }
}

function printQueueHelp(): void {
    console.log(chalk.bold("/queue"));
    console.log("  /queue [list]         — show pending and running requests");
    console.log(
        "  /queue cancel <id>    — cancel a queued or running request (id prefix ≥4 chars)",
    );
    console.log(
        "  /queue interrupt <text> — cancel running request and run <text> next, ahead of queue",
    );
    console.log("  /queue help           — show this help");
}

const slashCommands: SlashCommand[] = [
    {
        name: "help",
        description: "Show available commands",
        handler: async (_args, processCommand) => {
            // Print slash commands first, then delegate to @system help
            console.log(chalk.bold("\nSlash Commands:"));
            for (const cmd of slashCommands) {
                console.log(
                    `  ${chalk.cyanBright("/" + cmd.name.padEnd(16))} ${chalk.dim(cmd.description)}`,
                );
            }
            console.log("");
            return processCommand("@system help");
        },
    },
    {
        name: "clear",
        description: "Clear the terminal screen",
        handler: async () => {
            process.stdout.write("\x1b[2J\x1b[H");
        },
    },
    {
        name: "verbose",
        description: "Toggle verbose debug output",
        handler: async (args) => {
            handleVerbose(args);
        },
    },
    {
        name: "trace",
        description: "Manage debug trace namespaces",
        handler: async (args, processCommand) => {
            return processCommand(`@system trace ${args}`);
        },
    },
    {
        name: "history",
        description: "Show conversation history",
        handler: async (args, processCommand) => {
            return processCommand(`@system history ${args}`);
        },
    },
    {
        name: "session",
        description: "Session management",
        handler: async (args, processCommand) => {
            return processCommand(`@system session ${args}`);
        },
    },
    {
        name: "config",
        description: "View or edit configuration",
        handler: async (args, processCommand) => {
            return processCommand(`@system config ${args}`);
        },
    },
    {
        name: "agents",
        description: "List available agents",
        handler: async (_args, processCommand) => {
            return processCommand("@system config agents");
        },
    },
    {
        name: "conversation",
        description: "Manage conversations (new, switch, list, rename, delete)",
        handler: async (args) => {
            if (conversationContext === undefined) {
                console.log(
                    chalk.red(
                        "Conversation commands are not available (no server connection).",
                    ),
                );
                return;
            }
            return handleConversationCommand(conversationContext, args);
        },
    },
    {
        name: "shutdown",
        description: "Shut down the agent server",
        handler: async () => {
            const port = serverPort ?? AGENT_SERVER_DEFAULT_PORT;
            console.log(
                chalk.dim(
                    `Sending shutdown request to server on port ${port}...`,
                ),
            );
            try {
                if (serverConnection) {
                    await serverConnection.shutdown();
                } else {
                    await stopAgentServer(port, true);
                }
                console.log(chalk.green("Agent server stopped."));
            } catch (e: any) {
                console.log(
                    chalk.red(`Failed to shut down agent server: ${e.message}`),
                );
            }
            return { exit: true };
        },
    },
    {
        name: "restart",
        description:
            "Restart the agent server (reload rebuilt code); this CLI disconnects",
        handler: async () => {
            const port = serverPort ?? AGENT_SERVER_DEFAULT_PORT;
            if (!serverConnection) {
                console.log(
                    chalk.red(
                        "Not connected to an agent server; cannot restart.",
                    ),
                );
                return;
            }
            console.log(
                chalk.dim(
                    `Requesting restart of server on port ${port}; it will relaunch and this CLI will disconnect. Reconnect with 'agent-cli connect'.`,
                ),
            );
            try {
                await serverConnection.restart();
            } catch {
                // Expected: the connection drops as the server exits to
                // relaunch, so the restart RPC never returns cleanly.
            }
            return { exit: true };
        },
    },
    {
        name: "queue",
        description:
            "Inspect or cancel queued / running requests on the server-side message queue",
        handler: async (args) => {
            const parts = args.trim().split(/\s+/).filter(Boolean);
            const sub = parts[0]?.toLowerCase() ?? "list";
            if (sub === "help") {
                printQueueHelp();
                return;
            }
            if (sub === "list" || parts.length === 0) {
                const snap = await refreshQueueSnapshot();
                if (!snap) {
                    console.log(
                        chalk.dim(
                            "Queue is unavailable (dispatcher does not expose getQueueSnapshot).",
                        ),
                    );
                    return;
                }
                console.log(formatQueueSnapshot(snap));
                return;
            }
            if (sub === "cancel") {
                const idPrefix = parts[1];
                if (!idPrefix) {
                    console.log(
                        chalk.yellow(
                            "Usage: /queue cancel <id>   (id prefix ≥4 chars)",
                        ),
                    );
                    return;
                }
                const d = queueDispatcher;
                if (!d || typeof d.cancelCommand !== "function") {
                    console.log(
                        chalk.dim(
                            "Cancel is unavailable (no active dispatcher).",
                        ),
                    );
                    return;
                }
                const snap = await refreshQueueSnapshot();
                if (!snap) {
                    console.log(
                        chalk.dim("Queue is unavailable for resolution."),
                    );
                    return;
                }
                const resolved = resolveRequestIdPrefix(idPrefix, snap);
                if (!resolved.ok) {
                    console.log(chalk.yellow(resolved.error));
                    return;
                }
                let result;
                try {
                    result = await d.cancelCommand(resolved.requestId);
                } catch (e: any) {
                    console.log(
                        chalk.red(`Cancel failed: ${e?.message ?? String(e)}`),
                    );
                    return;
                }
                const short = shortId(resolved.requestId);
                switch (result?.kind) {
                    case "cancelled_queued":
                        console.log(
                            chalk.yellow(`✗ cancelled (queued): ${short}`),
                        );
                        break;
                    case "cancelled_running":
                        console.log(
                            chalk.yellow(`✗ cancelled (running): ${short}`),
                        );
                        break;
                    case "already_completed":
                        console.log(chalk.dim(`! already completed: ${short}`));
                        break;
                    case "not_found":
                    default:
                        console.log(chalk.dim(`! not found: ${short}`));
                        break;
                }
                return;
            }
            if (sub === "interrupt") {
                const rawArgs = args.trim();
                // Strip leading "interrupt" token; avoid split/rejoin which collapses inner whitespace.
                const text = rawArgs.replace(/^interrupt\s+/i, "").trim();
                if (!text) {
                    console.log(chalk.yellow("Usage: /queue interrupt <text>"));
                    return;
                }
                const d = queueDispatcher;
                if (!d || typeof d.interrupt !== "function") {
                    console.log(
                        chalk.dim(
                            "Interrupt is unavailable (dispatcher does not expose interrupt).",
                        ),
                    );
                    return;
                }
                let result;
                try {
                    result = await d.interrupt(text);
                } catch (e: any) {
                    console.log(
                        chalk.red(
                            `Interrupt failed: ${e?.message ?? String(e)}`,
                        ),
                    );
                    return;
                }
                if (result?.ok) {
                    const short = shortId(result.entry.requestId);
                    console.log(
                        chalk.cyan(`↯ interrupted; running next: ${short}`),
                    );
                } else if (result?.error === "queue_full") {
                    console.log(
                        chalk.red(
                            `Interrupt rejected: queue full (max ${result.maxDepth}).`,
                        ),
                    );
                } else if (result?.error === "server_stopping") {
                    console.log(
                        chalk.red(
                            "Interrupt rejected: server is shutting down.",
                        ),
                    );
                } else {
                    console.log(chalk.red("Interrupt failed: unknown error."));
                }
                return;
            }
            console.log(chalk.yellow(`Unknown /queue subcommand: ${sub}`));
            printQueueHelp();
        },
    },
    {
        name: "exit",
        description: "Exit the CLI",
        handler: async () => {
            // Return a sentinel value that the main loop recognizes
            return { exit: true };
        },
    },
];

const commandMap = new Map<string, SlashCommand>();
for (const cmd of slashCommands) {
    commandMap.set(cmd.name, cmd);
}

export function isSlashCommand(input: string): boolean {
    return (
        input.startsWith("/") ||
        input.startsWith("@conversation ") ||
        input === "@conversation"
    );
}

const conversationSubcommands = ["new", "switch", "list", "rename", "delete"];

export function getSlashCompletions(input: string): string[] {
    // Handle @conversation <partial-subcommand> completions
    if (input.startsWith("@conversation")) {
        const after = input.slice("@conversation".length);
        // "@conversation" with no space yet — offer all subcommands
        if (after === "") {
            return conversationSubcommands.map((s) => `@conversation ${s}`);
        }
        if (after.startsWith(" ")) {
            const partial = after.slice(1).toLowerCase();
            return conversationSubcommands
                .filter((s) => s.startsWith(partial))
                .map((s) => `@conversation ${s}`);
        }
        return [];
    }
    const prefix = input.substring(1).toLowerCase();
    return slashCommands
        .filter((cmd) => cmd.name.startsWith(prefix))
        .map((cmd) => "/" + cmd.name);
}

export interface SlashCommandResult {
    handled: boolean;
    exit?: boolean;
    result?: any;
}

export async function handleSlashCommand(
    input: string,
    processCommand: (command: string) => Promise<any>,
): Promise<SlashCommandResult> {
    // Rewrite @conversation to /conversation so it routes through the
    // slash command system (avoids the spinner path in processCommandsEnhanced)
    let normalized = input;
    if (input.startsWith("@conversation")) {
        normalized = "/conversation" + input.substring("@conversation".length);
    }

    const trimmed = normalized.substring(1).trim();
    const spaceIdx = trimmed.indexOf(" ");
    const name =
        spaceIdx === -1
            ? trimmed.toLowerCase()
            : trimmed.substring(0, spaceIdx).toLowerCase();
    const args = spaceIdx === -1 ? "" : trimmed.substring(spaceIdx + 1).trim();

    const cmd = commandMap.get(name);
    if (!cmd) {
        console.log(chalk.yellow(`Unknown command: ${input}`));
        console.log(chalk.dim("Type /help to see available commands."));
        return { handled: true };
    }

    const result = await cmd.handler(args, processCommand);
    if (result?.exit) {
        return { handled: true, exit: true };
    }
    return { handled: true, result };
}
