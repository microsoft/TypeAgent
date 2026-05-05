// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatPanel } from "chat-ui";
import "chat-ui/styles";

import { vsPlatformAdapter } from "./platformAdapter.js";
import {
    connectDispatcher,
    type DispatcherHandle,
} from "./dispatcherConnection.js";

let chatPanel: ChatPanel;
let dispatcherHandle: DispatcherHandle | undefined;
let banner: HTMLDivElement;
let reconnectTimer: ReturnType<typeof setInterval> | undefined;
let bannerHideTimer: ReturnType<typeof setTimeout> | undefined;

function initialize() {
    const root = document.getElementById("chat-root")!;

    banner = document.createElement("div");
    banner.className = "connection-banner";
    banner.textContent = "Connecting to TypeAgent...";
    root.appendChild(banner);

    const chatContainer = document.createElement("div");
    chatContainer.style.flex = "1 1 auto";
    chatContainer.style.minHeight = "0";
    root.appendChild(chatContainer);

    chatPanel = new ChatPanel(chatContainer, {
        platformAdapter: vsPlatformAdapter,
        onSend: handleUserMessage,
        getCompletions: async (input: string) => {
            try {
                const completions =
                    await dispatcherHandle?.dispatcher.getCompletions(input);
                return completions ?? null;
            } catch {
                return null;
            }
        },
        getDynamicDisplay: async (source: string, displayId: string) => {
            const result = await dispatcherHandle?.dispatcher.getDynamicDisplay(
                source,
                "html",
                displayId,
            );
            return result as any;
        },
    });

    attemptConnect();
    chatPanel.focus();
}

function handleUserMessage(
    text: string,
    attachments: string[] | undefined,
    requestId: string,
) {
    if (!dispatcherHandle) {
        chatPanel.addAgentMessage(
            {
                type: "text",
                content: "Not connected to agent server.",
                kind: "error",
            },
            "system",
        );
        return;
    }
    chatPanel.setEnabled(false);
    chatPanel.showStatus("Processing...");

    dispatcherHandle.dispatcher
        .processCommand(text, requestId, attachments)
        .then(() => {
            chatPanel.setEnabled(true);
            chatPanel.focus();
        })
        .catch((err: Error) => {
            chatPanel.addAgentMessage(
                {
                    type: "text",
                    content: `Failed: ${err.message}`,
                    kind: "error",
                },
                "system",
            );
            chatPanel.setEnabled(true);
            chatPanel.focus();
        });
}

function attemptConnect() {
    connectDispatcher(chatPanel)
        .then((handle) => {
            dispatcherHandle = handle;
            handle.onConnectionChange(setConnectionStatus);
            setConnectionStatus(true);
        })
        .catch(() => {
            setConnectionStatus(false);
        });
}

function setConnectionStatus(connected: boolean) {
    if (bannerHideTimer) {
        clearTimeout(bannerHideTimer);
        bannerHideTimer = undefined;
    }
    if (connected) {
        if (reconnectTimer) {
            clearInterval(reconnectTimer);
            reconnectTimer = undefined;
        }
        banner.textContent = "Connected to TypeAgent";
        banner.className = "connection-banner connected";
        banner.style.display = "";
        chatPanel.setEnabled(true);
        bannerHideTimer = setTimeout(() => {
            banner.style.display = "none";
        }, 3000);
    } else {
        banner.textContent =
            "Not connected — ensure agent-server is running on ws://localhost:8999";
        banner.className = "connection-banner";
        banner.style.display = "";
        chatPanel.setEnabled(false);
        if (!reconnectTimer) {
            reconnectTimer = setInterval(() => {
                banner.textContent = "Reconnecting to TypeAgent...";
                attemptConnect();
            }, 5000);
        }
    }
}

document.addEventListener("DOMContentLoaded", initialize);
