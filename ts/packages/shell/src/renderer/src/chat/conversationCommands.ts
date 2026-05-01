// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Conversation command handler — intercepts `/conversation` (and its
 * `@conversation` alias) in the renderer process and executes them via
 * the preload API, displaying results in the chat view.
 *
 * Returns `true` if the text was a conversation command (handled), `false` otherwise.
 */

import type {
    ConversationInfo,
    ConversationSwitchResult,
} from "../../../preload/electronTypes";
import { getClientAPI } from "../main";

export type ConversationMessageSink = {
    addSystemMessage(content: string): void;
    clear(): void;
    /**
     * Run `work` while showing a busy indicator (e.g. disabled input box
     * with a status placeholder).  Restored on completion, including on
     * throw.  Implementations may choose to no-op.
     */
    withBusy<T>(message: string, work: () => Promise<T>): Promise<T>;
};

/**
 * Try to handle a `/conversation` (or `@conversation`) command.  Returns true
 * if the command was recognized and handled (caller should not forward it to
 * the dispatcher).
 *
 * `@conversation` is accepted as an alias and normalized to `/conversation`
 * before parsing, matching the CLI's behaviour.
 */
export async function handleConversationCommand(
    text: string,
    sink: ConversationMessageSink,
): Promise<boolean> {
    const trimmed = text.trim();

    // Accept both /conversation and @conversation
    let normalized: string;
    if (trimmed.startsWith("@conversation")) {
        normalized = "/conversation" + trimmed.slice("@conversation".length);
    } else if (trimmed.startsWith("/conversation")) {
        normalized = trimmed;
    } else {
        return false;
    }

    const parts = normalized.split(/\s+/);
    const subcommand = parts[1]?.toLowerCase();

    const api = getClientAPI();

    try {
        if (!subcommand || subcommand === "help") {
            showConversationHelp(sink);
            return true;
        }

        switch (subcommand) {
            case "list": {
                const conversations = await api.conversationList();
                const current = await api.conversationGetCurrent();
                formatConversationList(
                    conversations,
                    current?.conversationId,
                    sink,
                );
                return true;
            }

            case "new":
            case "create": {
                const name = parts.slice(2).join(" ") || "New Conversation";
                const conversation = await sink.withBusy(
                    "Creating conversation…",
                    () => api.conversationCreate(name),
                );
                sink.addSystemMessage(
                    `✅ Created conversation "<b>${escapeHtml(conversation.name)}</b>" (${conversation.conversationId})`,
                );
                return true;
            }

            case "switch": {
                const target = parts.slice(2).join(" ");
                if (!target) {
                    // No name → cycle to the next conversation.
                    return cycleConversation(1, sink);
                }
                // Try to resolve by name first, then by ID
                const conversationId = await resolveConversationTarget(target);
                const result: ConversationSwitchResult = await sink.withBusy(
                    "Switching conversation…",
                    () => api.conversationSwitch(conversationId),
                );
                if (result.success) {
                    sink.addSystemMessage(
                        `🔄 Switched to conversation "<b>${escapeHtml(result.name ?? conversationId)}</b>"`,
                    );
                } else {
                    sink.addSystemMessage(
                        `❌ ${escapeHtml(result.error ?? "Failed to switch conversation")}`,
                    );
                }
                return true;
            }

            case "prev":
            case "previous":
                return cycleConversation(-1, sink);

            case "next":
                return cycleConversation(1, sink);

            case "info": {
                const current = await api.conversationGetCurrent();
                if (!current) {
                    sink.addSystemMessage("No active conversation.");
                } else {
                    sink.addSystemMessage(
                        `<b>Current conversation:</b> ${escapeHtml(current.name)} (${escapeHtml(current.conversationId)})`,
                    );
                }
                return true;
            }

            case "rename": {
                // /conversation rename <id|name> <new name>
                const target = parts[2];
                const newName = parts.slice(3).join(" ");
                if (!target || !newName) {
                    sink.addSystemMessage(
                        "Usage: <code>/conversation rename &lt;id|name&gt; &lt;newName&gt;</code>",
                    );
                    return true;
                }
                const conversationId = await resolveConversationTarget(target);
                await api.conversationRename(conversationId, newName);
                sink.addSystemMessage(
                    `✅ Renamed conversation ${escapeHtml(conversationId)} to "<b>${escapeHtml(newName)}</b>"`,
                );
                return true;
            }

            case "delete": {
                const target = parts.slice(2).join(" ");
                if (!target) {
                    sink.addSystemMessage(
                        "Usage: <code>/conversation delete &lt;id|name&gt;</code>",
                    );
                    return true;
                }
                const conversationId = await resolveConversationTarget(target);
                await api.conversationDelete(conversationId);
                sink.addSystemMessage(
                    `🗑️ Deleted conversation ${escapeHtml(target)}`,
                );
                return true;
            }

            default:
                sink.addSystemMessage(
                    `Unknown conversation command: <code>${escapeHtml(subcommand)}</code>`,
                );
                showConversationHelp(sink);
                return true;
        }
    } catch (e: any) {
        sink.addSystemMessage(
            `❌ Conversation command failed: ${escapeHtml(e.message ?? String(e))}`,
        );
        return true;
    }
}

function showConversationHelp(sink: ConversationMessageSink): void {
    sink.addSystemMessage(
        [
            "<b>Conversation Commands</b>",
            "<code>/conversation list</code> — List all conversations",
            "<code>/conversation new [name]</code> — Create a new conversation",
            "<code>/conversation switch [id|name]</code> — Switch to a conversation (no argument cycles to the next)",
            "<code>/conversation prev</code> — Switch to the previous conversation (wraps around)",
            "<code>/conversation next</code> — Switch to the next conversation (wraps around)",
            "<code>/conversation info</code> — Show current conversation info",
            "<code>/conversation rename &lt;id|name&gt; &lt;name&gt;</code> — Rename a conversation",
            "<code>/conversation delete &lt;id|name&gt;</code> — Delete a conversation",
            "",
            "Tip: <code>@conversation</code> is accepted as an alias for <code>/conversation</code>.",
        ].join("<br>"),
    );
}

async function cycleConversation(
    delta: number,
    sink: ConversationMessageSink,
): Promise<true> {
    const api = getClientAPI();
    const conversations = await api.conversationList();
    if (conversations.length === 0) {
        sink.addSystemMessage("No conversations to switch to.");
        return true;
    }
    const current = await api.conversationGetCurrent();
    const curIdx = current
        ? conversations.findIndex(
              (s) => s.conversationId === current.conversationId,
          )
        : -1;
    const targetIdx =
        curIdx === -1
            ? 0
            : (curIdx + delta + conversations.length) % conversations.length;
    const target = conversations[targetIdx];
    if (target.conversationId === current?.conversationId) {
        // Single conversation — nothing to do.
        sink.addSystemMessage("No other conversation to switch to.");
        return true;
    }
    const result: ConversationSwitchResult = await sink.withBusy(
        "Switching conversation…",
        () => api.conversationSwitch(target.conversationId),
    );
    if (result.success) {
        sink.addSystemMessage(
            `🔄 Switched to conversation "<b>${escapeHtml(result.name ?? target.name)}</b>"`,
        );
    } else {
        sink.addSystemMessage(
            `❌ ${escapeHtml(result.error ?? "Failed to switch conversation")}`,
        );
    }
    return true;
}

function formatConversationList(
    conversations: ConversationInfo[],
    currentId: string | undefined,
    sink: ConversationMessageSink,
): void {
    if (conversations.length === 0) {
        sink.addSystemMessage("No conversations found.");
        return;
    }

    const lines = conversations.map((s) => {
        const marker =
            s.conversationId === currentId ? " ← <b>current</b>" : "";
        const date = new Date(s.createdAt).toLocaleDateString();
        return `• <b>${escapeHtml(s.name)}</b> (${escapeHtml(s.conversationId)}) — ${s.clientCount} client(s), created ${date}${marker}`;
    });

    sink.addSystemMessage(
        `<b>Conversations (${conversations.length})</b><br>${lines.join("<br>")}`,
    );
}

async function resolveConversationTarget(target: string): Promise<string> {
    // If it looks like a UUID, use it directly
    if (
        target.match(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        ) ||
        target === "local"
    ) {
        return target;
    }

    // Otherwise try to match by name
    const api = getClientAPI();
    const conversations = await api.conversationList();
    const match = conversations.find(
        (s) => s.name.toLowerCase() === target.toLowerCase(),
    );
    if (match) {
        return match.conversationId;
    }

    // Fall back to using it as-is (let the backend reject if invalid)
    return target;
}

export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
