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
import type { ClientIO, Dispatcher } from "agent-dispatcher";
import { debugShell } from "./debug.js";

/**
 * Replay display history entries from a dispatcher through clientIO.
 * This sends user requests, agent displays, and interaction outcomes
 * through the same IPC pipeline that live messages use, so the renderer
 * displays them identically without needing any special handling.
 */
export async function replayDisplayHistory(
    dispatcher: Dispatcher,
    clientIO: ClientIO,
    conversationName?: string,
    markHistoryFn?: () => void,
): Promise<void> {
    const entries = await dispatcher.getDisplayHistory();
    const ts = Date.now(); // ensure unique clientRequestIds across replays

    if (entries.length === 0) {
        // Nothing to mark as history — skip markHistoryFn entirely.
        if (conversationName !== undefined) {
            clientIO.setDisplay({
                message: {
                    type: "text",
                    content: `Connected to conversation '${conversationName}'. (no history)`,
                    kind: "info",
                },
                requestId: {
                    requestId: "",
                    clientRequestId: `notification-conversation-info-${ts}`,
                },
                source: "conversation",
            });
        }
        return;
    }

    debugShell(
        `Replaying ${entries.length} history entries for conversation "${conversationName}"`,
    );

    // Send a "conversation history" separator notification
    clientIO.setDisplay({
        message: {
            type: "text",
            content: "─── conversation history ───",
            kind: "info",
        },
        requestId: {
            requestId: "",
            clientRequestId: `notification-conversation-history-start-${ts}`,
        },
        source: "conversation",
    });

    for (const entry of entries) {
        switch (entry.type) {
            case "user-request":
                clientIO.setUserRequest(entry.requestId, entry.command);
                break;
            case "set-display":
                clientIO.setDisplay(entry.message);
                break;
            case "append-display":
                clientIO.appendDisplay(entry.message, entry.mode);
                break;
            case "set-display-info":
                clientIO.setDisplayInfo(
                    entry.requestId,
                    entry.source,
                    entry.actionIndex,
                    entry.action,
                );
                break;
            // pending-interaction, interaction-resolved, interaction-cancelled
            // are not replayed — the Shell does not yet support deferred
            // interactions so there is no UI to display them.
            // notify entries are ephemeral — skip them.
        }
    }

    // Mark all replayed entries as history (grayscale) before adding the "now"
    // separator. All messages go through the same webContents IPC channel, so
    // this event is guaranteed to be processed before the separator below.
    markHistoryFn?.();

    // Send a "now" separator + connected notification
    clientIO.setDisplay({
        message: {
            type: "text",
            content: "─── now ───",
            kind: "info",
        },
        requestId: {
            requestId: "",
            clientRequestId: `notification-conversation-history-end-${ts}`,
        },
        source: "conversation",
    });

    if (conversationName !== undefined) {
        clientIO.setDisplay({
            message: {
                type: "text",
                content: `Connected to conversation '${conversationName}'.`,
                kind: "info",
            },
            requestId: {
                requestId: "",
                clientRequestId: `notification-conversation-connected-${ts}`,
            },
            source: "conversation",
        });
    }
}

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
    sendConversationChanged: (conversationId: string, name: string) => void,
    onDispatcherSwitch?: (newDispatcher: Dispatcher) => void,
    markHistoryFn?: () => void,
): ConversationManagerBackend {
    let currentConversationId = initialConversationId;
    let currentName = initialName;

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
            if (conversationId === currentConversationId) {
                return {
                    success: true,
                    conversationId: currentConversationId,
                    name: currentName,
                };
            }

            const oldConversationId = currentConversationId;

            // Phase 1: join new conversation. If this fails we haven't left the old
            // one, so fall through to the catch and report failure cleanly.
            let newConversation: Awaited<
                ReturnType<typeof connection.joinConversation>
            >;
            try {
                newConversation = await connection.joinConversation(clientIO, {
                    conversationId,
                });
            } catch (e: any) {
                debugShell(
                    "Failed to join conversation %s: %s",
                    conversationId,
                    e.message,
                );
                return {
                    success: false,
                    error: e.message ?? String(e),
                };
            }

            // Override close so it doesn't close the shared WebSocket
            newConversation.dispatcher.close = async () => {
                await connection.leaveConversation(
                    newConversation.conversationId,
                );
            };

            // Phase 2: commit the switch. We are now joined to the new conversation,
            // so tracked state must be updated regardless of what happens next.
            currentConversationId = newConversation.conversationId;
            currentName = newConversation.name;

            // Best-effort leave of the old conversation — a failure here does not
            // undo the switch; the client is already on the new conversation.
            try {
                await connection.leaveConversation(oldConversationId);
            } catch (e: any) {
                debugShell(
                    "Failed to leave old conversation %s (best-effort, ignoring): %s",
                    oldConversationId,
                    e.message,
                );
            }

            // Notify the shell that the dispatcher has changed so it can
            // rebind its command-processing pipeline to the new instance.
            onDispatcherSwitch?.(newConversation.dispatcher);

            // Clear the renderer and replay the new conversation's display
            // history through clientIO (same IPC path as live messages).
            clientIO.clear({
                requestId: "",
                clientRequestId: "conversation-switch",
            });
            try {
                await replayDisplayHistory(
                    newConversation.dispatcher,
                    clientIO,
                    newConversation.name,
                    markHistoryFn,
                );
            } catch (e: any) {
                // History replay is best-effort — the switch itself succeeded.
                debugShell(
                    "Failed to replay display history for conversation %s: %s",
                    newConversation.name,
                    e.message,
                );
            }

            sendConversationChanged(currentConversationId, currentName);

            return {
                success: true,
                conversationId: currentConversationId,
                name: currentName,
            };
        },

        async renameConversation(
            conversationId: string,
            newName: string,
        ): Promise<void> {
            await connection.renameConversation(conversationId, newName);
            // If the renamed conversation is the current one, update tracked name
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
    };
}
