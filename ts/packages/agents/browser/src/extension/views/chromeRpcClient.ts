// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createChannelAdapter,
    type ChannelAdapter,
} from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";

/**
 * Creates an RPC client in an extension view (popup, sidepanel, etc.) that
 * communicates with the service worker via chrome.runtime messages.
 *
 * Messages are tagged with `{ type: "rpc", message: <rpc payload> }`.
 */
export function createChromeRpcClient<
    InvokeTargets extends Record<
        string,
        (...args: any[]) => Promise<any>
    > = {},
    CallTargets extends Record<string, (...args: any[]) => void> = {},
>(): { adapter: ChannelAdapter; rpc: ReturnType<typeof createRpc> } {
    const adapter = createChannelAdapter((message: any) => {
        chrome.runtime
            .sendMessage({ type: "rpc", message })
            .catch(() => {});
    });

    chrome.runtime.onMessage.addListener(
        (msg: any, _sender: chrome.runtime.MessageSender) => {
            if (msg.type === "rpc") {
                adapter.notifyMessage(msg.message);
            }
        },
    );

    const rpc = createRpc<InvokeTargets, CallTargets>(
        "browser:view",
        adapter.channel,
    );

    return { adapter, rpc };
}
