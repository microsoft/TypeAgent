// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shell conversation manager — provides IPC handlers for conversation management.
 *
 * In "local" mode (in-process dispatcher), multi-conversation is not supported.
 * The handlers return a single "default" conversation and reject conversation switching.
 *
 * In "remote" mode (connected to agent server), the handlers delegate to the
 * AgentServerConnection's conversation API.
 */

import { ipcMain } from "electron";
import type {
    ConversationInfo,
    ConversationSwitchResult,
} from "../preload/electronTypes.js";
import type { AgentServerConnection } from "@typeagent/agent-server-client";
import {
    manageConversation,
    switchConversationSafe,
    type ConversationActionResult,
    type ManageConversationContext,
    type ManageConversationPayload,
} from "@typeagent/agent-server-client/conversation";
import type { ClientIO, Dispatcher, QueueSnapshot } from "agent-dispatcher";
import { debugShell } from "./debug.js";
import { saveUserSettings } from "agent-dispatcher/helpers/userSettings";

export type ConversationManageResult = {
    html: string;
    kind: "info" | "warning" | "error";
    switched?: boolean;
};

export type ConversationManagerBackend = {
    listConversations(): Promise<ConversationInfo[]>;
    createConversation(name: string): Promise<ConversationInfo>;
    switchConversation(
        conversationId: string,
    ): Promise<ConversationSwitchResult>;
    renameConversation(conversationId: string, newName: string): Promise<void>;
    deleteConversation(conversationId: string): Promise<void>;
    getCurrentConversation(): Promise<
        { conversationId: string; name: string } | undefined
    >;
    manageAction(
        payload: ManageConversationPayload,
    ): Promise<ConversationManageResult>;
};

/**
 * Create a local-only conversation backend for in-process dispatcher mode.
 * Multi-conversation is not supported; all calls operate on a single default conversation.
 */
export function createLocalConversationBackend(): ConversationManagerBackend {
    const defaultConversation: ConversationInfo = {
        conversationId: "local",
        name: "Default Conversation",
        clientCount: 1,
        createdAt: new Date().toISOString(),
    };

    return {
        async listConversations(): Promise<ConversationInfo[]> {
            return [defaultConversation];
        },
        async createConversation(_name: string): Promise<ConversationInfo> {
            throw new Error(
                "Multi-conversation is not supported in local mode. " +
                    "Connect to the Agent Server to use conversation management.",
            );
        },
        async switchConversation(
            _conversationId: string,
        ): Promise<ConversationSwitchResult> {
            return {
                success: false,
                error:
                    "Conversation switching is not supported in local mode. " +
                    "Connect to the Agent Server to use conversation management.",
            };
        },
        async renameConversation(
            _conversationId: string,
            _newName: string,
        ): Promise<void> {
            throw new Error(
                "Conversation renaming is not supported in local mode. " +
                    "Connect to the Agent Server to use conversation management.",
            );
        },
        async deleteConversation(_conversationId: string): Promise<void> {
            throw new Error(
                "Conversation deletion is not supported in local mode. " +
                    "Connect to the Agent Server to use conversation management.",
            );
        },
        async getCurrentConversation(): Promise<
            { conversationId: string; name: string } | undefined
        > {
            return {
                conversationId: defaultConversation.conversationId,
                name: defaultConversation.name,
            };
        },
        async manageAction(): Promise<ConversationManageResult> {
            return {
                html: "Conversation management is not supported in local mode. Connect to the Agent Server to use conversation management.",
                kind: "warning",
            };
        },
    };
}

/**
 * Register conversation management IPC handlers on ipcMain.
 * Returns a cleanup function that removes the handlers.
 */
export function registerConversationIpcHandlers(
    backend: ConversationManagerBackend,
): () => void {
    const handlers = {
        "conversation-list": async () => {
            debugShell("IPC: conversation-list");
            return backend.listConversations();
        },
        "conversation-create": async (
            _event: Electron.IpcMainInvokeEvent,
            name: string,
        ) => {
            debugShell("IPC: conversation-create name=%s", name);
            return backend.createConversation(name);
        },
        "conversation-switch": async (
            _event: Electron.IpcMainInvokeEvent,
            conversationId: string,
        ) => {
            debugShell(
                "IPC: conversation-switch conversationId=%s",
                conversationId,
            );
            return backend.switchConversation(conversationId);
        },
        "conversation-rename": async (
            _event: Electron.IpcMainInvokeEvent,
            conversationId: string,
            newName: string,
        ) => {
            debugShell(
                "IPC: conversation-rename conversationId=%s newName=%s",
                conversationId,
                newName,
            );
            return backend.renameConversation(conversationId, newName);
        },
        "conversation-delete": async (
            _event: Electron.IpcMainInvokeEvent,
            conversationId: string,
        ) => {
            debugShell(
                "IPC: conversation-delete conversationId=%s",
                conversationId,
            );
            return backend.deleteConversation(conversationId);
        },
        "conversation-get-current": async () => {
            debugShell("IPC: conversation-get-current");
            return backend.getCurrentConversation();
        },
        "conversation-manage-action": async (
            _event: Electron.IpcMainInvokeEvent,
            payload: ManageConversationPayload,
        ) => {
            debugShell(
                "IPC: conversation-manage-action subcommand=%s",
                payload?.subcommand,
            );
            return backend.manageAction(payload);
        },
    };

    for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.handle(channel, handler);
    }

    return () => {
        for (const channel of Object.keys(handlers)) {
            ipcMain.removeHandler(channel);
        }
    };
}

/**
 * Create a remote conversation backend that delegates to an AgentServerConnection.
 * Uses join-before-leave when switching conversations to avoid stranded clients.
 */
export function createRemoteConversationBackend(
    connection: AgentServerConnection,
    clientIO: ClientIO,
    initialConversationId: string,
    initialName: string,
    sendConversationChanged: (
        conversationId: string,
        name: string,
        queueSnapshot?: QueueSnapshot,
    ) => void,
    onDispatcherSwitch?: (newDispatcher: Dispatcher) => void,
): ConversationManagerBackend {
    let currentConversationId = initialConversationId;
    let currentName = initialName;
    let pendingQueueSnapshot: QueueSnapshot | undefined;

    // Per-instance queue serializes switch-causing ops. Concurrent
    // switches from the same start state would otherwise both join
    // different targets and both leave the same old id, stranding
    // server-side channels and racing UI broadcasts.
    let switchQueue: Promise<unknown> = Promise.resolve();
    const serializeSwitch = <T>(op: () => Promise<T>): Promise<T> => {
        const next = switchQueue.then(op, op);
        switchQueue = next.catch(() => undefined);
        return next;
    };

    // Pre-leave: dispatcher rebind + state mutation only. Broadcasts are
    // deferred to broadcastSwitched (after the old conversation is left)
    // so the renderer's clear-and-replay never races with lingering
    // events from the previous conversation.
    const commitSwitch = (
        newConversation: Awaited<
            ReturnType<typeof connection.joinConversation>
        >,
    ): void => {
        newConversation.dispatcher.close = async () => {
            await connection.leaveConversation(newConversation.conversationId);
        };
        currentConversationId = newConversation.conversationId;
        currentName = newConversation.name;
        pendingQueueSnapshot = newConversation.queueSnapshot;
        onDispatcherSwitch?.(newConversation.dispatcher);
    };

    // Post-leave: safe to tell the renderer to clear + replay.
    const broadcastSwitched = (): void => {
        sendConversationChanged(
            currentConversationId,
            currentName,
            pendingQueueSnapshot,
        );
        pendingQueueSnapshot = undefined;
    };

    const persistLastId = (id: string): void => {
        try {
            saveUserSettings({ conversation: { lastConversationId: id } });
        } catch (e: any) {
            debugShell(
                "Failed to persist lastConversationId on switch (ignoring): %s",
                e.message,
            );
        }
    };

    const logLeaveOld = (oldId: string, err: unknown): void => {
        if (err !== undefined) {
            debugShell(
                "Failed to leave old conversation %s (best-effort, ignoring): %s",
                oldId,
                (err as { message?: string })?.message ?? String(err),
            );
        }
    };

    return {
        async listConversations(): Promise<ConversationInfo[]> {
            return connection.listConversations();
        },

        async createConversation(name: string): Promise<ConversationInfo> {
            return connection.createConversation(name);
        },

        async switchConversation(
            conversationId: string,
        ): Promise<ConversationSwitchResult> {
            return serializeSwitch(async () => {
                if (conversationId === currentConversationId) {
                    return {
                        success: true,
                        conversationId: currentConversationId,
                        name: currentName,
                    };
                }

                const result = await switchConversationSafe(
                    connection,
                    clientIO,
                    currentConversationId,
                    conversationId,
                    {
                        onJoined: commitSwitch,
                        onPersist: persistLastId,
                        onLeftOld: (oldId, err) => {
                            logLeaveOld(oldId, err);
                            broadcastSwitched();
                        },
                    },
                );

                if (result.kind === "join-failed") {
                    const e = result.error as { message?: string } | undefined;
                    debugShell(
                        "Failed to join conversation %s: %s",
                        conversationId,
                        e?.message ?? String(result.error),
                    );
                    return {
                        success: false,
                        error: e?.message ?? String(result.error),
                    };
                }

                return {
                    success: true,
                    conversationId: currentConversationId,
                    name: currentName,
                };
            });
        },

        async renameConversation(
            conversationId: string,
            newName: string,
        ): Promise<void> {
            await connection.renameConversation(conversationId, newName);
            if (conversationId === currentConversationId) {
                currentName = newName;
                sendConversationChanged(currentConversationId, currentName);
            }
        },

        async deleteConversation(conversationId: string): Promise<void> {
            if (conversationId === currentConversationId) {
                throw new Error(
                    "Cannot delete the currently active conversation. Switch to another conversation first.",
                );
            }
            return connection.deleteConversation(conversationId);
        },

        async getCurrentConversation(): Promise<
            { conversationId: string; name: string } | undefined
        > {
            return {
                conversationId: currentConversationId,
                name: currentName,
            };
        },

        async manageAction(
            payload: ManageConversationPayload,
        ): Promise<ConversationManageResult> {
            return serializeSwitch(async () => {
                const ctx: ManageConversationContext = {
                    currentConversationId,
                    currentConversationName: currentName,
                    getCurrentConversationId: () => currentConversationId,
                    onSwitched: commitSwitch,
                    onAfterSwitched: () => broadcastSwitched(),
                    onPersistSwitched: persistLastId,
                    onCurrentConversationUpdated: (updated) => {
                        currentName = updated.name;
                        sendConversationChanged(
                            currentConversationId,
                            currentName,
                        );
                    },
                };
                const result = await manageConversation(
                    connection,
                    clientIO,
                    ctx,
                    payload,
                );

                return renderConversationActionResult(result);
            });
        },
    };
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => {
        switch (c) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            default:
                return "&#39;";
        }
    });
}

// Replace plain "<name>" runs in helper messages with bold-escaped HTML.
function htmlizeMessage(message: string): string {
    return message.replace(
        /"([^"]+)"/g,
        (_, name) => `"<b>${escapeHtml(name)}</b>"`,
    );
}

function renderConversationActionResult(
    result: ConversationActionResult,
): ConversationManageResult {
    switch (result.kind) {
        case "ok":
            return {
                html: htmlizeMessage(result.message),
                kind: "info",
                ...(result.switched ? { switched: true } : {}),
            };
        case "warning":
            return {
                html: htmlizeMessage(result.message),
                kind: "warning",
            };
        case "error":
            return {
                html: `❌ ${htmlizeMessage(result.message)}`,
                kind: "error",
            };
        case "cancelled":
            return { html: "Cancelled.", kind: "info" };
        case "info":
            return {
                html:
                    `<b>Current conversation:</b><br>` +
                    `Name: ${escapeHtml(result.name)}<br>` +
                    `<span style="font-family:monospace;font-size:smaller;">${escapeHtml(result.conversationId)}</span>`,
                kind: "info",
            };
        case "list": {
            if (result.conversations.length === 0) {
                return { html: "<i>No conversations found.</i>", kind: "info" };
            }
            const items = result.conversations
                .map((s) => {
                    const cur =
                        s.conversationId === result.currentConversationId
                            ? "▸ "
                            : "";
                    return `<li>${cur}${escapeHtml(s.name)}</li>`;
                })
                .join("");
            return { html: `<ul>${items}</ul>`, kind: "info" };
        }
    }
}
