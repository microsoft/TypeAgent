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

    const manager = new SessionManager(connection);

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
                const items = list.map((info) => {
                    const item = controller.createChatSessionItem(
                        resourceFor(info.conversationId),
                        info.name,
                    );
                    item.tooltip = new vscode.MarkdownString(
                        `**${info.name}**\n\n\`${info.conversationId}\``,
                    );
                    item.timing = timingFor(info.createdAt);
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

    controller.newChatSessionItemHandler = async (ctx, _token) => {
        try {
            const seed = ctx.request.prompt?.trim();
            const name = seed
                ? seed.slice(0, 40)
                : `VS Code Chat ${new Date().toLocaleTimeString()}`;
            const created = await connection.createConversation(name);
            const item = controller.createChatSessionItem(
                resourceFor(created.conversationId),
                created.name,
            );
            item.timing = timingFor(created.createdAt);
            controller.items.add(item);
            return item;
        } catch (e) {
            console.error("[TypeAgent] newChatSessionItemHandler error:", e);
            throw e;
        }
    };

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
