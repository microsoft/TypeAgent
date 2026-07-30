// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared presentation for `manage-conversation` results. Produces structured
// DisplayContent (blocks) so every host (Electron shell, VS Code shell) renders
// the same thing inside the message bubble; non-UI clients still get the
// auto-derived markdown/text fallback.

import type { DisplayContent, StructuredBlock } from "@typeagent/agent-sdk";
import { createStructuredContent } from "@typeagent/agent-sdk/helpers/display";
import type { ConversationActionResult } from "./manage.js";

// Bold quoted names for the markdown text blocks - parity with the shells'
// previous HTML that bolded quoted conversation names.
function boldQuoted(message: string): string {
    return message.replace(/"([^"]+)"/g, (_, name) => `**${name}**`);
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
            const items = result.conversations.map((c) => {
                const created = new Date(c.createdAt).toLocaleDateString();
                const messages = `${c.messageCount} message${
                    c.messageCount === 1 ? "" : "s"
                }`;
                const clients = `${c.clientCount} client${
                    c.clientCount === 1 ? "" : "s"
                }`;
                const isCurrent =
                    c.conversationId === result.currentConversationId;
                return {
                    text: isCurrent ? `${c.name} (current)` : c.name,
                    subtitle: `${messages} · ${clients} · created ${created}`,
                };
            });
            const blocks: StructuredBlock[] = [
                {
                    kind: "heading",
                    level: 3,
                    text: `Conversations (${result.conversations.length})`,
                },
                { kind: "list", items },
            ];
            return createStructuredContent(blocks);
        }
    }
}
