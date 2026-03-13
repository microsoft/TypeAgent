// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createChannelAdapter,
    type ChannelAdapter,
} from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";

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
        chrome.runtime.sendMessage({ type: "rpc", message }).catch(() => {});
    });

    chrome.runtime.onMessage.addListener(
        (msg: any, _sender: chrome.runtime.MessageSender) => {
            if (msg.type === "rpc") {
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
