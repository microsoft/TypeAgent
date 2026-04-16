// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import * as readline from "readline";
import type {
    AgentServerConnection,
    SessionDispatcher,
    SessionInfo,
} from "@typeagent/agent-server-client";

/**
 * Context required by conversation commands. Created in connect.ts after
 * the agent server connection is established.
 */
export type ConversationCommandContext = {
    connection: AgentServerConnection;
    getCurrentSessionId: () => string;
    getCurrentSessionName: () => string;
    switchSession: (sessionId: string) => Promise<SessionDispatcher>;
};

// ── Name resolution ────────────────────────────────────────────────────

/**
 * Resolve a conversation name to a single SessionInfo using
 * case-insensitive exact matching.
 */
async function resolveByName(
    connection: AgentServerConnection,
    name: string,
): Promise<SessionInfo> {
    const all = await connection.listSessions();
    const matches = all.filter(
        (s) => s.name.toLowerCase() === name.toLowerCase(),
    );
    if (matches.length === 0) {
        throw new Error(
            `No conversation named '${name}' found. Use @conversation list to see all.`,
        );
    }
    if (matches.length > 1) {
        throw new Error(
            `Multiple conversations named '${name}' found. Use @conversation list to see all.`,
        );
    }
    return matches[0];
}

// ── Helpers ───────────────────────────────────────────────────────────

function promptYesNo(question: string): Promise<boolean> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(`${question} [y/N] `, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === "y");
        });
    });
}

/**
 * Parse the argument string, respecting double-quoted names.
 * Returns the trimmed argument (without surrounding quotes).
 */
function parseNameArg(args: string): string {
    const trimmed = args.trim();
    if (
        trimmed.startsWith('"') &&
        trimmed.endsWith('"') &&
        trimmed.length > 1
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

// ── Subcommand handlers ────────────────────────────────────────────────

async function handleNew(
    ctx: ConversationCommandContext,
    args: string,
): Promise<void> {
    const name = parseNameArg(args);
    if (!name) {
        console.log(chalk.yellow("Usage: @conversation new <name>"));
        return;
    }
    const created = await ctx.connection.createSession(name);
    console.log(`Created conversation '${chalk.green(name)}'.`);
    const switchNow = await promptYesNo(`Switch to '${name}' now?`);
    if (switchNow) {
        await ctx.switchSession(created.sessionId);
    }
}

async function handleSwitch(
    ctx: ConversationCommandContext,
    args: string,
): Promise<void> {
    const name = parseNameArg(args);
    if (!name) {
        console.log(chalk.yellow("Usage: @conversation switch <name>"));
        return;
    }
    const target = await resolveByName(ctx.connection, name);
    if (target.sessionId === ctx.getCurrentSessionId()) {
        console.log(chalk.yellow(`Already in conversation '${target.name}'.`));
        return;
    }
    await ctx.switchSession(target.sessionId);
}

async function handleList(
    ctx: ConversationCommandContext,
    args: string,
): Promise<void> {
    const filter = args.trim() || undefined;
    const sessions = await ctx.connection.listSessions(filter);
    if (sessions.length === 0) {
        console.log(chalk.dim("No conversations found."));
        return;
    }

    // Sort by creation date, most recent first
    sessions.sort(
        (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const currentId = ctx.getCurrentSessionId();

    // Calculate column widths
    const nameWidth = Math.max(4, ...sessions.map((s) => s.name.length));
    const header =
        "  " + "NAME".padEnd(nameWidth + 2) + "CREATED".padEnd(22) + "CLIENTS";
    const divider =
        "  " + "─".repeat(nameWidth + 2) + "─".repeat(22) + "───────";

    console.log(chalk.bold("\nConversations:"));
    console.log(chalk.dim(header));
    console.log(chalk.dim(divider));

    for (const s of sessions) {
        const isCurrent = s.sessionId === currentId;
        const marker = isCurrent ? "▸ " : "  ";
        const created = new Date(s.createdAt)
            .toISOString()
            .replace("T", " ")
            .substring(0, 16);
        const suffix = isCurrent ? "  (current)" : "";
        const line =
            marker +
            s.name.padEnd(nameWidth + 2) +
            created.padEnd(22) +
            String(s.clientCount) +
            suffix;
        console.log(isCurrent ? chalk.green(line) : line);
    }
    console.log("");
}

async function handleRename(
    ctx: ConversationCommandContext,
    args: string,
): Promise<void> {
    const newName = parseNameArg(args);
    if (!newName) {
        console.log(chalk.yellow("Usage: @conversation rename <newName>"));
        return;
    }
    await ctx.connection.renameSession(ctx.getCurrentSessionId(), newName);
    console.log(`Renamed current conversation to '${chalk.green(newName)}'.`);
}

async function handleDelete(
    ctx: ConversationCommandContext,
    args: string,
): Promise<void> {
    const name = parseNameArg(args);
    if (!name) {
        console.log(chalk.yellow("Usage: @conversation delete <name>"));
        return;
    }
    const target = await resolveByName(ctx.connection, name);
    if (target.sessionId === ctx.getCurrentSessionId()) {
        console.log(
            chalk.red(
                "Cannot delete the active conversation. Switch to another conversation first.",
            ),
        );
        return;
    }
    const confirmed = await promptYesNo(
        `Delete conversation '${target.name}'?`,
    );
    if (!confirmed) {
        console.log(chalk.dim("Cancelled."));
        return;
    }
    await ctx.connection.deleteSession(target.sessionId);
    console.log(`Deleted conversation '${chalk.green(target.name)}'.`);
}

// ── Help text ──────────────────────────────────────────────────────────

function printHelp(): void {
    console.log(chalk.bold("\n@conversation commands:"));
    const cmds: [string, string][] = [
        ["new <name>", "Create a new conversation"],
        ["switch <name>", "Switch to a conversation by name"],
        ["list [<filter>]", "List all conversations"],
        ["rename <newName>", "Rename the current conversation"],
        ["delete <name>", "Delete a conversation by name"],
    ];
    for (const [usage, desc] of cmds) {
        console.log(
            `  ${chalk.cyanBright(("@conversation " + usage).padEnd(38))} ${chalk.dim(desc)}`,
        );
    }
    console.log("");
}

// ── Main entry point ───────────────────────────────────────────────────

const subcommands: Record<
    string,
    (ctx: ConversationCommandContext, args: string) => Promise<void>
> = {
    new: handleNew,
    switch: handleSwitch,
    list: handleList,
    rename: handleRename,
    delete: handleDelete,
};

/**
 * Handle a conversation command. Called from the slash command system.
 *
 * @param ctx - The conversation command context (connection, session state, switch callback)
 * @param args - Everything after "conversation", e.g. "list" or "switch myChat"
 */
export async function handleConversationCommand(
    ctx: ConversationCommandContext,
    args: string,
): Promise<void> {
    const trimmed = args.trim();
    if (!trimmed) {
        printHelp();
        return;
    }

    const spaceIdx = trimmed.indexOf(" ");
    const sub =
        spaceIdx === -1
            ? trimmed.toLowerCase()
            : trimmed.substring(0, spaceIdx).toLowerCase();
    const subArgs = spaceIdx === -1 ? "" : trimmed.substring(spaceIdx + 1);

    const handler = subcommands[sub];
    if (!handler) {
        console.log(
            chalk.yellow(
                `Unknown subcommand '${sub}'. Available: new, switch, list, rename, delete`,
            ),
        );
        return;
    }

    try {
        await handler(ctx, subArgs);
    } catch (err: any) {
        console.log(chalk.red(`Error: ${err?.message ?? String(err)}`));
    }
}
