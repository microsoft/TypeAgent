// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createChannelAdapter,
    type ChannelAdapter,
} from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";

const trustedViewPaths = new Set([
    "/views/annotationsLibrary.html",
    "/views/chatPanel.html",
    "/views/entityGraphView.html",
    "/views/knowledgeLibrary.html",
    "/views/macrosLibrary.html",
    "/views/memoryCenter.html",
    "/views/options.html",
    "/views/pdfView.html",
    "/views/topicGraphView.html",
]);

export function isTrustedRpcView(
    sender: chrome.runtime.MessageSender,
): boolean {
    if (
        !sender ||
        sender.id !== chrome.runtime.id ||
        !sender.url ||
        (sender.frameId !== undefined && sender.frameId !== 0)
    ) {
        return false;
    }
    try {
        const root = new URL(chrome.runtime.getURL("/"));
        const url = new URL(sender.url);
        return (
            (root.protocol === "chrome-extension:" ||
                root.protocol === "moz-extension:") &&
            url.protocol === root.protocol &&
            url.host === root.host &&
            sender.origin === `${root.protocol}//${root.host}` &&
            trustedViewPaths.has(url.pathname)
        );
    } catch {
        return false;
    }
}

/**
 * Creates an RPC server in the service worker that communicates with
 * extension views (popup, sidepanel, etc.) via chrome.runtime messages.
 *
 * Messages are tagged with `{ type: "rpc", message: <rpc payload> }` to
 * coexist with the legacy `handleMessage()` switch.
 */
export function createChromeRpcServer<
    InvokeHandlers extends Record<string, (...args: any[]) => Promise<any>>,
    CallHandlers extends Record<string, (...args: any[]) => void> = {},
    InvokeTargets extends Record<string, (...args: any[]) => Promise<any>> = {},
    CallTargets extends Record<string, (...args: any[]) => void> = {},
>(
    invokeHandlers: InvokeHandlers,
    callHandlers?: CallHandlers,
): { adapter: ChannelAdapter; rpc: ReturnType<typeof createRpc> } {
    const adapter = createChannelAdapter((message: any) => {
        chrome.runtime
            .sendMessage({ type: "rpc", target: "view", message })
            .catch(() => {});
    });

    chrome.runtime.onMessage.addListener(
        (msg: any, sender: chrome.runtime.MessageSender) => {
            if (
                msg?.type === "rpc" &&
                msg.target === "serviceWorker" &&
                isTrustedRpcView(sender)
            ) {
                adapter.notifyMessage(msg.message);
            }
        },
    );

    const rpc = createRpc<
        InvokeTargets,
        CallTargets,
        InvokeHandlers,
        CallHandlers
    >("browser:sw", adapter.channel, invokeHandlers, callHandlers);

    return { adapter, rpc };
}
