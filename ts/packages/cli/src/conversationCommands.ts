// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import type {
    AgentServerConnection,
    ClientIO,
    ConversationDispatcher,
} from "@typeagent/agent-server-client";
import {
    manageConversation,
    switchConversationSafe,
    type ConversationActionResult,
    type ManageConversationContext,
    type ManageConversationPayload,
} from "@typeagent/agent-server-client/conversation";
import { confirmYesNo } from "./enhancedConsole.js";

export type ConversationCommandContext = {
    connection: AgentServerConnection;
    clientIO: ClientIO;
    getCurrentConversationId: () => string;
    getCurrentConversationName: () => string;
    onSwitched: (newConversation: ConversationDispatcher) => Promise<void>;
    onPersistSwitched?: (conversationId: string) => void;
};

// ── Arg parsing ────────────────────────────────────────────────────────

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

/**
 * Tokenize into up to `maxTokens` args, respecting double quotes. Any
 * remaining text after `maxTokens - 1` splits is returned verbatim
 * (unquoted) as the last token.
 */
function tokenizeArgs(args: string, maxTokens: number): string[] {
    const tokens: string[] = [];
    let remaining = args.trim();
    while (remaining.length > 0 && tokens.length < maxTokens) {
        if (remaining.startsWith('"')) {
            const close = remaining.indexOf('"', 1);
            if (close === -1) {
                tokens.push(remaining.slice(1));
                remaining = "";
            } else {
                tokens.push(remaining.slice(1, close));
                remaining = remaining.slice(close + 1).trimStart();
            }
        } else if (tokens.length === maxTokens - 1) {
            tokens.push(remaining);
            remaining = "";
        } else {
            const spaceIdx = remaining.search(/\s/);
            if (spaceIdx === -1) {
                tokens.push(remaining);
                remaining = "";
            } else {
                tokens.push(remaining.slice(0, spaceIdx));
                remaining = remaining.slice(spaceIdx).trimStart();
            }
        }
    }
    return tokens;
}

type ParsedCommand =
    | { ok: true; payload: ManageConversationPayload }
    | { ok: false; usage: string };

function parseSlashCommand(args: string): ParsedCommand {
    const trimmed = args.trim();
    const spaceIdx = trimmed.indexOf(" ");
    const sub =
        spaceIdx === -1
            ? trimmed.toLowerCase()
            : trimmed.substring(0, spaceIdx).toLowerCase();
    const subArgs = spaceIdx === -1 ? "" : trimmed.substring(spaceIdx + 1);

    switch (sub) {
        case "new": {
            const name = parseNameArg(subArgs);
            return {
                ok: true,
                payload: name
                    ? { subcommand: "new", name }
                    : { subcommand: "new" },
            };
        }
        case "switch": {
            const name = parseNameArg(subArgs);
            if (!name) {
                return { ok: false, usage: "@conversation switch <name>" };
            }
            return { ok: true, payload: { subcommand: "switch", name } };
        }
        case "list": {
            const filter = subArgs.trim();
            return {
                ok: true,
                payload: filter
                    ? { subcommand: "list", name: filter }
                    : { subcommand: "list" },
            };
        }
        case "info":
            return { ok: true, payload: { subcommand: "info" } };
        case "prev":
            return { ok: true, payload: { subcommand: "prev" } };
        case "next":
            return { ok: true, payload: { subcommand: "next" } };
        case "rename": {
            const tokens = tokenizeArgs(subArgs, 2);
            if (tokens.length === 0) {
                return {
                    ok: false,
                    usage:
                        "@conversation rename <newName>\n" +
                        "       @conversation rename <currentName> <newName>",
                };
            }
            if (tokens.length === 1) {
                return {
                    ok: true,
                    payload: { subcommand: "rename", newName: tokens[0] },
                };
            }
            return {
                ok: true,
                payload: {
                    subcommand: "rename",
                    name: tokens[0],
                    newName: tokens[1],
                },
            };
        }
        case "delete": {
            const name = parseNameArg(subArgs);
            if (!name) {
                return { ok: false, usage: "@conversation delete <name>" };
            }
            return { ok: true, payload: { subcommand: "delete", name } };
        }
        default:
            return {
                ok: false,
                usage: `Unknown subcommand '${sub}'. Available: new, switch, list, info, rename, delete`,
            };
    }
}

// ── Renderer ───────────────────────────────────────────────────────────

// Render quoted names in helper messages with chalk green to match the
// CLI's pre-refactor look.
function colorizeQuotedNames(message: string): string {
    return message.replace(/"([^"]+)"/g, (_, name) => `'${chalk.green(name)}'`);
}

function renderResult(result: ConversationActionResult): void {
    switch (result.kind) {
        case "ok":
            console.log(colorizeQuotedNames(result.message));
            break;
        case "warning":
            console.log(chalk.yellow(colorizeQuotedNames(result.message)));
            break;
        case "error":
            console.log(chalk.red(`Error: ${result.message}`));
            break;
        case "cancelled":
            console.log(chalk.dim("Cancelled."));
            break;
        case "info":
            console.log(chalk.bold("\nCurrent conversation:"));
            console.log(`  ${chalk.dim("Name:")}  ${chalk.green(result.name)}`);
            console.log(
                `  ${chalk.dim("ID:")}    ${chalk.dim(result.conversationId)}`,
            );
            console.log("");
            break;
        case "list": {
            const sessions = result.conversations;
            const currentId = result.currentConversationId;
            const nameWidth = Math.max(
                4,
                ...sessions.map((s) => s.name.length),
            );
            const header =
                "  " +
                "NAME".padEnd(nameWidth + 2) +
                "CREATED".padEnd(22) +
                "CLIENTS";
            const divider =
                "  " + "─".repeat(nameWidth + 2) + "─".repeat(22) + "───────";
            console.log(chalk.bold("\nConversations:"));
            console.log(chalk.dim(header));
            console.log(chalk.dim(divider));
            for (const s of sessions) {
                const isCurrent = s.conversationId === currentId;
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
            break;
        }
    }
}

// ── @conversation new — preserve the CLI's confirm-before-switch UX ───

async function handleNewWithConfirm(
    ctx: ConversationCommandContext,
    name: string | undefined,
): Promise<void> {
    if (!name) {
        console.log(chalk.yellow("Usage: @conversation new <name>"));
        return;
    }
    let created;
    try {
        created = await ctx.connection.createConversation(name);
    } catch (e: any) {
        console.log(chalk.red(`Error: ${e?.message ?? String(e)}`));
        return;
    }
    const switchNow = await confirmYesNo(`Switch to '${name}' now?`);
    if (!switchNow) {
        console.log(`Created conversation '${chalk.green(name)}'.`);
        return;
    }
    const result = await switchConversationSafe(
        ctx.connection,
        ctx.clientIO,
        ctx.getCurrentConversationId(),
        created.conversationId,
        {
            onJoined: ctx.onSwitched,
            ...(ctx.onPersistSwitched !== undefined
                ? { onPersist: ctx.onPersistSwitched }
                : {}),
        },
    );
    if (result.kind === "join-failed") {
        console.log(
            chalk.red(
                `Error: Failed to switch to '${name}': ${
                    (result.error as { message?: string })?.message ??
                    String(result.error)
                }`,
            ),
        );
    }
}

// ── Help text ──────────────────────────────────────────────────────────

function printHelp(): void {
    console.log(chalk.bold("\n@conversation commands:"));
    const cmds: [string, string][] = [
        ["new <name>", "Create a new conversation"],
        ["switch <name>", "Switch to a conversation by name"],
        ["list [<filter>]", "List all conversations"],
        ["info", "Show info about the current conversation"],
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

export async function handleConversationCommand(
    ctx: ConversationCommandContext,
    args: string,
): Promise<void> {
    const trimmed = args.trim();
    if (!trimmed) {
        printHelp();
        return;
    }

    const parsed = parseSlashCommand(trimmed);
    if (!parsed.ok) {
        console.log(chalk.yellow(parsed.usage));
        return;
    }

    if (parsed.payload.subcommand === "new") {
        try {
            await handleNewWithConfirm(ctx, parsed.payload.name);
        } catch (err: any) {
            console.log(chalk.red(`Error: ${err?.message ?? String(err)}`));
        }
        return;
    }

    const mctx: ManageConversationContext = {
        currentConversationId: ctx.getCurrentConversationId(),
        currentConversationName: ctx.getCurrentConversationName(),
        onSwitched: ctx.onSwitched,
        ...(ctx.onPersistSwitched !== undefined
            ? { onPersistSwitched: ctx.onPersistSwitched }
            : {}),
        confirmDestructive: async (_action, target) =>
            confirmYesNo(`Delete conversation '${target.name}'?`),
    };

    const result = await manageConversation(
        ctx.connection,
        ctx.clientIO,
        mctx,
        parsed.payload,
    );
    renderResult(result);
}
