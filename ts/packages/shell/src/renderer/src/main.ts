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

import { ClientAPI, SpeechToken } from "../../preload/electronTypes";
import { getSpeechToken } from "./speechToken";
import { createWebSocket, webapi } from "./webSocketAPI";
import * as jose from "jose";
import { createChatPanelClient } from "./chatPanelBridge";

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

    // Build the chat-ui ChatPanel + provider stack and the dispatcher Client
    // (which already contains its ClientIO). ChatPanel mounts itself into the
    // wrapper element.
    const { client, chatPanel, cameraView } = createChatPanelClient(
        wrapper,
        agents,
    );

    // The camera overlay lives alongside the panel and is toggled by the
    // image-capture provider.
    wrapper.appendChild(cameraView.getContainer());

    getClientAPI().registerClient(client);

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
