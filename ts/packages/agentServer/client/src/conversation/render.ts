// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared presentation for `manage-conversation` results. Produces structured
// DisplayContent (blocks) so every host (Electron shell, VS Code shell) renders
// the same thing inside the message bubble; non-UI clients still get the
// auto-derived markdown/text fallback.

import type {
    DisplayContent,
    StructuredBlock,
    TableCell,
    TableColumn,
} from "@typeagent/agent-sdk";
import {
    createStructuredContent,
    createTable,
} from "@typeagent/agent-sdk/helpers/display";
import type { ConversationActionResult } from "./manage.js";

// Bold quoted names for the markdown text blocks - parity with the shells'
// previous HTML that bolded quoted conversation names.
function boldQuoted(message: string): string {
    return message.replace(/"([^"]+)"/g, (_, name) => `**${name}**`);
}

// Render an ISO timestamp as `YYYY-MM-DD HH:MM` in local time. The format is
// human-readable and lexically sortable, so the table's client-side date sort
// orders conversations chronologically.
function formatCreated(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return iso;
    }
    const pad = (n: number) => n.toString().padStart(2, "0");
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
}

export function renderConversationActionResult(
    result: ConversationActionResult,
): DisplayContent {
    switch (result.kind) {
        case "ok":
            return createStructuredContent([
                { kind: "text", text: boldQuoted(result.message) },
            ]);
        case "warning":
            return createStructuredContent(
                [{ kind: "text", text: boldQuoted(result.message) }],
                { kind: "warning" },
            );
        case "error":
            return createStructuredContent(
                [{ kind: "text", text: boldQuoted(result.message) }],
                { kind: "error" },
            );
        case "cancelled":
            return createStructuredContent([
                { kind: "text", text: "Cancelled." },
            ]);
        case "info":
            return createStructuredContent([
                { kind: "heading", level: 3, text: "Current conversation" },
                {
                    kind: "keyValue",
                    pairs: [
                        { label: "Name", value: result.name },
                        { label: "Id", value: result.conversationId },
                    ],
                },
            ]);
        case "list": {
            if (result.conversations.length === 0) {
                return createStructuredContent([
                    { kind: "text", text: "No conversations found." },
                ]);
            }
            const columns: TableColumn[] = [
                { id: "name", header: "Name" },
                {
                    id: "messages",
                    header: "Messages",
                    type: "number",
                    align: "right",
                },
                {
                    id: "clients",
                    header: "Clients",
                    type: "number",
                    align: "right",
                },
                { id: "created", header: "Created", type: "date" },
            ];
            const rows: TableCell[][] = result.conversations.map((c) => {
                const isCurrent =
                    c.conversationId === result.currentConversationId;
                return [
                    isCurrent ? `${c.name} (current)` : c.name,
                    c.messageCount,
                    c.clientCount,
                    formatCreated(c.createdAt),
                ];
            });
            const blocks: StructuredBlock[] = [
                {
                    kind: "heading",
                    level: 3,
                    text: `Conversations (${result.conversations.length})`,
                },
                createTable(columns, rows),
            ];
            return createStructuredContent(blocks);
        }
        case "matches": {
            const items = result.matches.map((m) => {
                const c = m.conversation;
                const isCurrent =
                    c.conversationId === result.currentConversationId;
                const pct = `${Math.round(m.score * 100)}% match`;
                const messages = `${c.messageCount} message${
                    c.messageCount === 1 ? "" : "s"
                }`;
                return {
                    text: isCurrent ? `${c.name} (current)` : c.name,
                    subtitle: `${pct} · ${messages}`,
                };
            });
            const blocks: StructuredBlock[] = [
                {
                    kind: "heading",
                    level: 3,
                    text: `Matches for “${result.query}” (${result.matches.length})`,
                },
                { kind: "list", items },
            ];
            return createStructuredContent(blocks);
        }
        case "contentMatches": {
            const items = result.matches.map((m) => {
                const c = m.conversation;
                const isCurrent =
                    c.conversationId === result.currentConversationId;
                const pct = `${Math.round(m.score * 100)}% match`;
                const snippet = m.snippets[0];
                return {
                    text: isCurrent ? `${c.name} (current)` : c.name,
                    subtitle: snippet ? `${pct} · ${snippet}` : pct,
                };
            });
            const blocks: StructuredBlock[] = [
                {
                    kind: "heading",
                    level: 3,
                    text: `Content matches for “${result.query}” (${result.matches.length})`,
                },
                { kind: "list", items },
            ];
            return createStructuredContent(blocks);
        }
        case "help": {
            const rows: [string, string][] = [
                ["new [name]", "Create a new conversation"],
                ["list", "List all conversations"],
                ["find <name>", "Find conversations by name"],
                ["search <text>", "Search conversation content"],
                ["info", "Show the current conversation"],
                ["switch [name]", "Switch to a conversation (or the next one)"],
                ["next", "Switch to the next conversation"],
                ["prev", "Switch to the previous conversation"],
                ["rename [name] <newName>", "Rename a conversation"],
                ["delete <name>", "Delete a conversation"],
                ["help", "Show this help"],
            ];
            const items = rows.map(([usage, description]) => ({
                text: usage,
                subtitle: description,
            }));
            return createStructuredContent([
                { kind: "heading", level: 3, text: "Conversation commands" },
                { kind: "list", items },
            ]);
        }
    }
}
