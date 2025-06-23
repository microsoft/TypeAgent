// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ipcRenderer } from "electron";

// Server for the main process to call the inline browser renderer
export function setupInlineBrowserRendererProxy() {
    ipcRenderer.on("inline-browser-rpc-call", (_, message) =>
        window.postMessage({
            source: "preload",
            target: "contentScript",
            messageType: "rpc",
            body: message,
        }),
    );

    window.addEventListener("message", (event) => {
        if (
            event.data.target == "preload" &&
            event.data.source == "contentScript" &&
            event.data.messageType == "rpc" &&
            event.data.body
        ) {
            ipcRenderer.send("inline-browser-rpc-reply", event.data.body);
        }
    });
}

export async function sendScriptAction(
    body: any,
    timeout?: number,
    frameWindow?: Window | null,
    idPrefix?: string,
) {
    const timeoutPromise = new Promise((f) => setTimeout(f, timeout));

    const targetWindow = frameWindow ?? window;

    const actionPromise = new Promise<any | undefined>((resolve) => {
        let callId = new Date().getTime().toString();
        if (idPrefix) {
            callId = idPrefix + "_" + callId;
        }

        targetWindow.postMessage(
            {
                source: "preload",
                target: "contentScript",
                messageType: "scriptActionRequest",
                id: callId,
                body: body,
            },
            "*",
        );

        // if timeout is provided, wait for a response - otherwise fire and forget
        if (timeout) {
            const handler = (event: any) => {
                if (
                    event.data.target == "preload" &&
                    event.data.source == "contentScript" &&
                    event.data.messageType == "scriptActionResponse" &&
                    event.data.id == callId &&
                    event.data.body
                ) {
                    window.removeEventListener("message", handler);
                    resolve(event.data.body);
                }
            };

            window.addEventListener("message", handler, false);
        } else {
            resolve(undefined);
        }
    });

    if (timeout) {
        return Promise.race([actionPromise, timeoutPromise]);
    } else {
        return actionPromise;
    }
}
