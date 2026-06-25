// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import {
    connectAgentServer,
    type AgentServerConnection,
} from "@typeagent/agent-server-client";
import { SessionManager, PARTICIPANT_ID } from "./sessionManager.js";

const URI_SCHEME = "typeagent";
const CHAT_SESSION_TYPE = "typeagent";
const RENAME_SESSION_COMMAND = "typeagentChat.renameSessionCustom";
const DELETE_SESSION_COMMAND = "typeagentChat.deleteSessionCustom";

function resourceFor(conversationId: string): vscode.Uri {
    return vscode.Uri.parse(
        `${URI_SCHEME}:${encodeURIComponent(conversationId)}`,
    );
}

function conversationIdFrom(resource: vscode.Uri): string {
    return decodeURIComponent(
        resource.path.startsWith("/") ? resource.path.slice(1) : resource.path,
    );
}

function isUntitledConversation(conversationId: string): boolean {
    return conversationId.startsWith("untitled-");
}

function timingFor(createdAt: string): vscode.ChatSessionItem["timing"] {
    const created = Date.parse(createdAt);
    return Number.isNaN(created) ? undefined : { created };
}

function normalizedLabel(value: string): string {
    return value.trim();
}

function asUri(value: unknown): vscode.Uri | undefined {
    const uriLike = value as { scheme?: unknown; path?: unknown };
    if (
        value &&
        typeof value === "object" &&
        typeof uriLike.scheme === "string" &&
        typeof uriLike.path === "string"
    ) {
        return uriLike as vscode.Uri;
    }
    if (typeof value === "string") {
        try {
            return vscode.Uri.parse(value);
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function resourceFromMenuArg(arg: unknown): vscode.Uri | undefined {
    const payload = arg as {
        resource?: unknown;
        session?: { resource?: unknown };
        chatSessionItem?: { resource?: unknown };
    };

    return (
        asUri(arg) ??
        asUri(payload?.resource) ??
        asUri(payload?.session?.resource) ??
        asUri(payload?.chatSessionItem?.resource)
    );
}

export async function activate(
    context: vscode.ExtensionContext,
): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("typeagentChat");
    const url = cfg.get<string>("serverUrl")?.trim() || "ws://localhost:8999";

    let connection: AgentServerConnection;
    try {
        connection = await connectAgentServer(url, () => {
            vscode.window.showWarningMessage(
                `TypeAgent: disconnected from agent server (${url}).`,
            );
        });
    } catch (e) {
        vscode.window.showErrorMessage(
            `TypeAgent: failed to connect to ${url}: ${(e as Error).message}`,
        );
        return;
    }

    type ConversationLabelState = {
        confirmedLabel: string;
        lastObservedLabel: string;
        renameInFlight: boolean;
    };

    const manager = new SessionManager(connection);
    // Per-conversation rename sync state.
    const conversationLabelState = new Map<string, ConversationLabelState>();

    function upsertConversationState(
        conversationId: string,
        confirmedLabel: string,
        lastObservedLabel: string,
    ): ConversationLabelState {
        const state: ConversationLabelState = {
            confirmedLabel,
            lastObservedLabel,
            renameInFlight: false,
        };
        conversationLabelState.set(conversationId, state);
        return state;
    }

    function updateConversationItem(
        item: vscode.ChatSessionItem,
        info: { conversationId: string; name: string; createdAt?: string },
    ): void {
        upsertConversationState(info.conversationId, info.name, info.name);
        item.label = info.name;
        item.tooltip = new vscode.MarkdownString(
            `**${info.name}**\n\n\`${info.conversationId}\``,
        );
        if (info.createdAt !== undefined) {
            item.timing = timingFor(info.createdAt);
        }
    }

    async function syncRenamedItem(
        item: vscode.ChatSessionItem,
    ): Promise<void> {
        const conversationId = conversationIdFrom(item.resource);
        if (isUntitledConversation(conversationId)) {
            return;
        }
        let state = conversationLabelState.get(conversationId);
        if (state?.renameInFlight) {
            return;
        }
        if (state === undefined) {
            upsertConversationState(conversationId, item.label, item.label);
            return;
        }
        const requested = normalizedLabel(item.label);
        if (
            requested.length === 0 ||
            requested === normalizedLabel(state.confirmedLabel)
        ) {
            if (requested.length === 0) {
                updateConversationItem(item, {
                    conversationId,
                    name: state.confirmedLabel,
                });
            }
            return;
        }

        state.renameInFlight = true;
        try {
            await connection.renameConversation(conversationId, requested, {
                nameCollisionBehavior: "appendNumber",
            });
            const updated = (await connection.listConversations()).find(
                (info) => info.conversationId === conversationId,
            );
            updateConversationItem(
                item,
                updated ?? { conversationId, name: requested },
            );
        } catch (e) {
            updateConversationItem(item, {
                conversationId,
                name: state.confirmedLabel,
            });
            vscode.window.showErrorMessage(
                `TypeAgent: failed to rename conversation: ${(e as Error).message}`,
            );
        } finally {
            state = conversationLabelState.get(conversationId) ?? state;
            state.renameInFlight = false;
        }
    }

    context.subscriptions.push({
        dispose: () => {
            void manager.dispose().then(() => connection.close());
        },
    });

    const controller = vscode.chat.createChatSessionItemController(
        CHAT_SESSION_TYPE,
        async (_token) => {
            try {
                const list = await connection.listConversations();
                conversationLabelState.clear();
                const items = list.map((info) => {
                    const item = controller.createChatSessionItem(
                        resourceFor(info.conversationId),
                        info.name,
                    );
                    updateConversationItem(item, info);
                    return item;
                });
                controller.items.replace(items);
            } catch (e) {
                vscode.window.showErrorMessage(
                    `TypeAgent: failed to list conversations: ${
                        (e as Error).message
                    }`,
                );
            }
        },
    );
    context.subscriptions.push(controller);

    context.subscriptions.push(
        vscode.commands.registerCommand(
            RENAME_SESSION_COMMAND,
            async (arg: unknown) => {
                const resource = resourceFromMenuArg(arg);
                if (!resource || resource.scheme !== URI_SCHEME) {
                    vscode.window.showWarningMessage(
                        "TypeAgent: could not determine which session to rename.",
                    );
                    return;
                }

                const conversationId = conversationIdFrom(resource);
                if (isUntitledConversation(conversationId)) {
                    vscode.window.showWarningMessage(
                        "TypeAgent: untitled sessions cannot be renamed.",
                    );
                    return;
                }

                const existingItem = controller.items.get(resource);
                const currentLabel =
                    existingItem?.label ??
                    conversationLabelState.get(conversationId)
                        ?.confirmedLabel ??
                    conversationId;
                const requested = await vscode.window.showInputBox({
                    prompt: "Rename TypeAgent session",
                    value: currentLabel,
                    validateInput: (value) =>
                        value.trim().length === 0
                            ? "Session name cannot be empty"
                            : undefined,
                });
                if (requested === undefined) {
                    return;
                }

                const trimmed = requested.trim();
                if (trimmed === currentLabel) {
                    return;
                }

                try {
                    await connection.renameConversation(
                        conversationId,
                        trimmed,
                        {
                            nameCollisionBehavior: "appendNumber",
                        },
                    );
                    const updated = (await connection.listConversations()).find(
                        (info) => info.conversationId === conversationId,
                    );
                    const next =
                        existingItem ??
                        controller.createChatSessionItem(resource, trimmed);
                    updateConversationItem(
                        next,
                        updated ?? { conversationId, name: trimmed },
                    );
                    controller.items.add(next);
                } catch (e) {
                    vscode.window.showErrorMessage(
                        `TypeAgent: failed to rename conversation: ${(e as Error).message}`,
                    );
                }
            },
        ),
        vscode.commands.registerCommand(
            DELETE_SESSION_COMMAND,
            async (arg: unknown) => {
                const resource = resourceFromMenuArg(arg);
                if (!resource || resource.scheme !== URI_SCHEME) {
                    vscode.window.showWarningMessage(
                        "TypeAgent: could not determine which session to delete.",
                    );
                    return;
                }

                const conversationId = conversationIdFrom(resource);
                if (isUntitledConversation(conversationId)) {
                    return;
                }

                const label =
                    controller.items.get(resource)?.label ??
                    conversationLabelState.get(conversationId)
                        ?.confirmedLabel ??
                    conversationId;
                const confirm = await vscode.window.showWarningMessage(
                    `Delete TypeAgent session "${label}"? This cannot be undone.`,
                    { modal: true },
                    "Delete",
                );
                if (confirm !== "Delete") {
                    return;
                }

                try {
                    await connection.deleteConversation(conversationId);
                    conversationLabelState.delete(conversationId);
                    controller.items.delete(resource);
                    manager.scheduleDrop(conversationId);
                } catch (e) {
                    vscode.window.showErrorMessage(
                        `TypeAgent: failed to delete conversation: ${(e as Error).message}`,
                    );
                }
            },
        ),
    );

    controller.newChatSessionItemHandler = async (ctx, _token) => {
        try {
            const seed = ctx.request.prompt?.trim();
            const name = seed
                ? seed.slice(0, 40)
                : `VS Code Chat ${new Date().toLocaleTimeString()}`;
            const created = await connection.createConversation(name, {
                nameCollisionBehavior: "appendNumber",
            });
            const item = controller.createChatSessionItem(
                resourceFor(created.conversationId),
                created.name,
            );
            updateConversationItem(item, created);
            controller.items.add(item);
            return item;
        } catch (e) {
            console.error("[TypeAgent] newChatSessionItemHandler error:", e);
            throw e;
        }
    };
    context.subscriptions.push(
        controller.onDidChangeChatSessionItemState((item) => {
            const conversationId = conversationIdFrom(item.resource);
            if (isUntitledConversation(conversationId)) {
                return;
            }
            let state = conversationLabelState.get(conversationId);
            if (state === undefined) {
                upsertConversationState(conversationId, item.label, item.label);
                return;
            }
            const current = normalizedLabel(item.label);
            if (current === normalizedLabel(state.lastObservedLabel)) {
                return;
            }
            state.lastObservedLabel = item.label;
            void syncRenamedItem(item);
        }),
    );

    const participant = vscode.chat.createChatParticipant(
        PARTICIPANT_ID,
        async (request, chatContext, stream, token) => {
            const sessionCtx = chatContext.chatSessionContext;
            if (!sessionCtx) {
                stream.markdown(
                    "TypeAgent must be invoked from a TypeAgent chat session.",
                );
                return;
            }
            const conversationId = conversationIdFrom(
                sessionCtx.chatSessionItem.resource,
            );
            const state = manager.getOrCreate(conversationId);
            await state.handleRequest(connection, request, stream, token);
        },
    );
    participant.iconPath = new vscode.ThemeIcon("typeagent-logo");
    context.subscriptions.push(participant);

    const provider: vscode.ChatSessionContentProvider = {
        async provideChatSessionContent(resource, _token, providerContext) {
            const conversationId = conversationIdFrom(resource);
            if (isUntitledConversation(conversationId)) {
                return { history: [], requestHandler: undefined };
            }
            // When the chat view is closed, schedule a delayed drop so the
            // server can release the dispatcher. Reopening within the delay
            // cancels the drop via openSession().
            providerContext.inputState.onDidDispose(() => {
                manager.scheduleDrop(conversationId);
            });
            return await manager.openSession(conversationId);
        },
    };
    context.subscriptions.push(
        vscode.chat.registerChatSessionContentProvider(
            URI_SCHEME,
            provider,
            participant,
        ),
    );
}

export function deactivate(): void {
    // Subscriptions in context handle teardown.
}
