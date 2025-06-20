// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { RpcChannel } from "agent-rpc/channel";
import { getActiveTab } from "./tabManager";
import { createRpc } from "agent-rpc/rpc";
export function createExternalBrowserServer(channel: RpcChannel) {
    const browserControlInvokeFunctions = {
        goForward: async () => {
            const targetTab = await getActiveTab();
            await chrome.tabs.goForward(targetTab?.id!);
        },
        goBack: async () => {
            const targetTab = await getActiveTab();
            await chrome.tabs.goBack(targetTab?.id!);
        },
        reload: async () => {
            const targetTab = await getActiveTab();
            await chrome.tabs.reload(targetTab?.id!);
        },
    };
    return createRpc(channel, browserControlInvokeFunctions);
}
