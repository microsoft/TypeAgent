// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/// <reference path="../../lib/lib.android.d.ts" />

// Augment Window with the test hook exposed by the bootstrap below so that
// Playwright tests can inject interactions without requiring a live
// agent-server connection.
declare global {
    interface Window {
        __clientIO__?: import("agent-dispatcher").ClientIO;
    }
}

import {
    ClientAPI,
    ConversationInfo,
    SpeechToken,
} from "../../preload/electronTypes";
import { getSpeechToken } from "./speechToken";
import { createWebSocket, webapi } from "./webSocketAPI";
import * as jose from "jose";
import { createChatPanelClient } from "./chatPanelBridge";
import { ConversationBar } from "chat-ui";

// Load the shared chat-ui / completion-ui stylesheets. These are injected at
// runtime (after the static <link> stylesheets in chatView.html) so the
// ChatPanel is styled by its own CSS rather than the legacy shell rules.
import "chat-ui/styles";
import "@typeagent/completion-ui/styles.css";

export function isElectron(): boolean {
    return globalThis.api !== undefined;
}

export function getClientAPI(): ClientAPI {
    if (globalThis.api !== undefined) {
        return globalThis.api;
    } else {
        return getWebSocketAPI();
    }
}

export function getAndroidAPI() {
    return globalThis.Android;
}

function getWebSocketAPI(): ClientAPI {
    if (globalThis.webApi === undefined) {
        globalThis.webApi = webapi;

        createWebSocket(true).then((ws) => (globalThis.ws = ws));
    }

    return globalThis.webApi;
}

// IdGenerator produces clientRequestIds for commands originated from
// this shell renderer. The prefix is a per-launch random suffix so ids
// are globally unique across shell launches: a fresh launch otherwise
// resets the counter to 0 and collides with prior-session ids that
// linger in the agent-server's DisplayLog (and in any peer client's
// userMessageById / agentContainersByRequestId maps), which can cause
// silently-dropped mirror bubbles in connected peers.
export class IdGenerator {
    private count = 0;
    private readonly prefix: string;
    constructor() {
        this.prefix =
            typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID().slice(0, 8)
                : Math.random().toString(36).slice(2, 10);
    }
    public genId() {
        return `cmd-${this.prefix}-${this.count++}`;
    }
}

document.addEventListener("DOMContentLoaded", async function () {
    const wrapper = document.getElementById("wrapper")!;
    const agents = new Map<string, string>();
    const clientAPI = getClientAPI();

    const layout = document.createElement("div");
    layout.className = "chat-shell-layout";
    const chatRoot = document.createElement("div");
    chatRoot.className = "chat-shell-panel";
    layout.appendChild(chatRoot);
    wrapper.appendChild(layout);

    const conversationBar = new ConversationBar(layout, {
        showCreateButton: true,
        icons: {
            rename: { text: "✎" },
            delete: { text: "⌫" },
            save: { text: "✓" },
            cancel: { text: "×" },
        },
        controller: {
            requestConversations: () => refreshConversations(),
            createConversation: async (name) => {
                await clientAPI.conversationCreate(name);
                await refreshConversations();
            },
            switchConversation: async (conversationId) => {
                const result =
                    await clientAPI.conversationSwitch(conversationId);
                if (!result.success) {
                    throw new Error(
                        result.error ?? "Failed to switch conversation.",
                    );
                }
                await refreshConversations();
            },
            renameConversation: async (conversationId, name) => {
                await clientAPI.conversationRename(conversationId, name);
                await refreshConversations();
            },
            deleteConversation: async (conversationId) => {
                await clientAPI.conversationDelete(conversationId);
                await refreshConversations();
            },
        },
    });
    const conversationBarEl = conversationBar.getContainer();
    layout.insertBefore(conversationBarEl, chatRoot);
    window.addEventListener("beforeunload", () => conversationBar.dispose());

    let refreshConversationsPromise: Promise<void> | undefined;

    async function refreshConversations(): Promise<void> {
        refreshConversationsPromise ??= refreshConversationsCore().finally(
            () => {
                refreshConversationsPromise = undefined;
            },
        );
        return refreshConversationsPromise;
    }

    async function refreshConversationsCore(): Promise<void> {
        try {
            const [conversations, current] = await Promise.all([
                clientAPI.conversationList(),
                clientAPI.conversationGetCurrent(),
            ]);
            const isLocalOnly = isLocalOnlyConversationMode(conversations);
            setConversationBarVisible(!isLocalOnly);
            if (isLocalOnly) return;
            conversationBar.setStatus({
                connected: true,
                errorText: undefined,
            });
            conversationBar.setConversations(
                conversations.map((conversation) => ({
                    conversationId: conversation.conversationId,
                    name: conversation.name,
                    clientCount: conversation.clientCount,
                })),
                current?.conversationId,
            );
            if (current) {
                conversationBar.setCurrentConversation(
                    current.conversationId,
                    current.name,
                );
            }
        } catch (e: any) {
            setConversationBarVisible(true);
            conversationBar.setStatus({ connected: false });
            conversationBar.setError(e?.message ?? String(e));
        }
    }

    function setConversationBarVisible(visible: boolean): void {
        conversationBarEl.hidden = !visible;
    }

    function isLocalOnlyConversationMode(conversations: ConversationInfo[]) {
        return (
            conversations.length === 1 &&
            conversations[0]?.conversationId === "local"
        );
    }

    // Build the chat-ui ChatPanel + provider stack and the dispatcher Client
    // (which already contains its ClientIO). ChatPanel mounts itself into the
    // wrapper element.
    const { client, chatPanel, cameraView } = createChatPanelClient(
        chatRoot,
        agents,
    );

    const baseConversationChanged = client.conversationChanged?.bind(client);
    client.conversationChanged = (conversationId, name, queueSnapshot) => {
        conversationBar.setCurrentConversation(conversationId, name);
        void refreshConversations();
        baseConversationChanged?.(conversationId, name, queueSnapshot);
    };

    // The camera overlay lives alongside the panel and is toggled by the
    // image-capture provider.
    wrapper.appendChild(cameraView.getContainer());

    clientAPI.registerClient(client);
    void refreshConversations();

    // Expose the clientIO object on window for integration tests so that tests
    // can trigger requestInteraction / interactionResolved / interactionCancelled
    // without requiring a live agent-server connection.
    if (window.__clientIO__ !== undefined) {
        console.warn(
            "[registerClient] window.__clientIO__ is already set — registerClient() called more than once.",
        );
    }
    window.__clientIO__ = client.clientIO;

    try {
        if (Android !== undefined) {
            Bridge.interfaces.Android.domReady((userMessage: string) => {
                chatPanel.injectCommand(userMessage);
            });
        }
    } catch (e) {
        console.log(e);
    }

    // get the user's name to show in the chat view
    const token: SpeechToken | undefined = await getSpeechToken();
    const actualToken = token?.token.substring(token?.token.indexOf("#"));
    if (actualToken) {
        const decoded = jose.decodeJwt(actualToken);

        if (decoded.given_name) {
            chatPanel.setUserInfo(
                decoded.given_name.toString().toLocaleLowerCase(),
            );
        }
    }
});
