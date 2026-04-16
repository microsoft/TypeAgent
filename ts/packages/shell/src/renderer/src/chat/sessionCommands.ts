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
    SessionInfo,
    SessionSwitchResult,
} from "../../../preload/electronTypes";
import { getClientAPI } from "../main";

export type SessionMessageSink = {
    addSystemMessage(content: string): void;
    clear(): void;
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
    sink: SessionMessageSink,
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
                const sessions = await api.sessionList();
                const current = await api.sessionGetCurrent();
                formatSessionList(sessions, current?.sessionId, sink);
                return true;
            }

            case "new":
            case "create": {
                const name = parts.slice(2).join(" ") || "New Conversation";
                const session = await api.sessionCreate(name);
                sink.addSystemMessage(
                    `✅ Created conversation "<b>${escapeHtml(session.name)}</b>" (${session.sessionId})`,
                );
                return true;
            }

            case "switch": {
                const target = parts.slice(2).join(" ");
                if (!target) {
                    sink.addSystemMessage(
                        "Usage: <code>/conversation switch &lt;id|name&gt;</code>",
                    );
                    return true;
                }
                // Try to resolve by name first, then by ID
                const sessionId = await resolveSessionTarget(target);
                const result: SessionSwitchResult =
                    await api.sessionSwitch(sessionId);
                if (result.success) {
                    sink.addSystemMessage(
                        `🔄 Switched to conversation "<b>${escapeHtml(result.name ?? sessionId)}</b>"`,
                    );
                } else {
                    sink.addSystemMessage(
                        `❌ ${escapeHtml(result.error ?? "Failed to switch conversation")}`,
                    );
                }
                return true;
            }

            case "rename": {
                // /conversation rename <id> <new name>
                const sessionId = parts[2];
                const newName = parts.slice(3).join(" ");
                if (!sessionId || !newName) {
                    sink.addSystemMessage(
                        "Usage: <code>/conversation rename &lt;id&gt; &lt;newName&gt;</code>",
                    );
                    return true;
                }
                await api.sessionRename(sessionId, newName);
                sink.addSystemMessage(
                    `✅ Renamed conversation ${escapeHtml(sessionId)} to "<b>${escapeHtml(newName)}</b>"`,
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
                const sessionId = await resolveSessionTarget(target);
                await api.sessionDelete(sessionId);
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

function showConversationHelp(sink: SessionMessageSink): void {
    sink.addSystemMessage(
        [
            "<b>Conversation Commands</b>",
            "<code>/conversation list</code> — List all conversations",
            "<code>/conversation new [name]</code> — Create a new conversation",
            "<code>/conversation switch &lt;id|name&gt;</code> — Switch to a conversation",
            "<code>/conversation rename &lt;id&gt; &lt;name&gt;</code> — Rename a conversation",
            "<code>/conversation delete &lt;id|name&gt;</code> — Delete a conversation",
            "",
            "Tip: <code>@conversation</code> is accepted as an alias for <code>/conversation</code>.",
        ].join("<br>"),
    );
}

function formatSessionList(
    sessions: SessionInfo[],
    currentId: string | undefined,
    sink: SessionMessageSink,
): void {
    if (sessions.length === 0) {
        sink.addSystemMessage("No conversations found.");
        return;
    }

    const lines = sessions.map((s) => {
        const marker = s.sessionId === currentId ? " ← <b>current</b>" : "";
        const date = new Date(s.createdAt).toLocaleDateString();
        return `• <b>${escapeHtml(s.name)}</b> (${escapeHtml(s.sessionId)}) — ${s.clientCount} client(s), created ${date}${marker}`;
    });

    sink.addSystemMessage(
        `<b>Conversations (${sessions.length})</b><br>${lines.join("<br>")}`,
    );
}

async function resolveSessionTarget(target: string): Promise<string> {
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
    const sessions = await api.sessionList();
    const match = sessions.find(
        (s) => s.name.toLowerCase() === target.toLowerCase(),
    );
    if (match) {
        return match.sessionId;
    }

    // Fall back to using it as-is (let the backend reject if invalid)
    return target;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
