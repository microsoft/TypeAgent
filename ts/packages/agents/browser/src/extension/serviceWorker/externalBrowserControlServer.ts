// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { RpcChannel } from "agent-rpc/channel";
import { getActiveTab } from "./tabManager";
import { createRpc } from "agent-rpc/rpc";
import {
    BrowserControlCallFunctions,
    BrowserControlInvokeFunctions,
} from "../../agent/interface.mjs";
import { showBadgeBusy, showBadgeHealthy } from "./ui";
export function createExternalBrowserServer(channel: RpcChannel) {
    const invokeFunctions: BrowserControlInvokeFunctions = {
        openWebPage: async (url: string) => {
            const targetTab = await getActiveTab();
            if (targetTab) {
                await chrome.tabs.update(targetTab.id!, { url });
            } else {
                await chrome.tabs.create({ url });
            }
        },
        closeWebPage: async () => {
            const targetTab = await getActiveTab();
            if (targetTab) {
                await chrome.tabs.remove(targetTab.id!);
            } else {
                throw new Error("No active tab to close.");
            }
        },
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
        getPageUrl: async () => {
            const targetTab = await getActiveTab();

            if (targetTab) {
                const url = targetTab.url;
                if (url) {
                    return url;
                }
                throw new Error(
                    "Unable to to retrieve URL from the active tab.",
                );
            } else {
                throw new Error("No active tab to get URL from.");
            }
        },
    };
    const callFunctions: BrowserControlCallFunctions = {
        setAgentStatus: ({ isBusy, message }) => {
            if (isBusy) {
                showBadgeBusy();
            } else {
                showBadgeHealthy();
            }
            console.log(`${message} (isBusy: ${isBusy})`);
        },
    };
    return createRpc(channel, invokeFunctions, callFunctions);
}
