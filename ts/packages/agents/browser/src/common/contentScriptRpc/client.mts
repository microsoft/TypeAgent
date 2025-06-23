// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ContentScriptRpc } from "./types.mjs";
import type { RpcChannel } from "agent-rpc/channel";
import { createRpc } from "agent-rpc/rpc";

export function createContentScriptRpcClient(channel: RpcChannel) {
    const contentScriptRpcClient = createRpc<ContentScriptRpc>(
        "browser:content",
        channel,
    );

    return {
        scrollUp: () => contentScriptRpcClient.invoke("scrollUp"),
        scrollDown: () => contentScriptRpcClient.invoke("scrollDown"),
    };
}
