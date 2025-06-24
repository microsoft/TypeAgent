// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createGenericChannel, RpcChannel } from "agent-rpc/channel";
import { getActiveTab } from "./tabManager";
import { createRpc } from "agent-rpc/rpc";
import {
    BrowserControlCallFunctions,
    BrowserControlInvokeFunctions,
} from "../../agent/browserControl.mjs";
import { showBadgeBusy, showBadgeHealthy } from "./ui";
import { createContentScriptRpcClient } from "../../common/contentScriptRpc/client.mjs";
export function createExternalBrowserServer(channel: RpcChannel) {
    const contentScriptRpcChannel = createGenericChannel(
        async (message, cb) => {
            try {
                const targetTab = await getActiveTab();
                await chrome.tabs.sendMessage(targetTab?.id!, {
                    type: "rpc",
                    message,
                });
            } catch (error) {
                console.error(
                    "Error sending message to content script:",
                    error,
                );
                if (cb) {
                    cb(error as Error);
                }
            }
        },
    );

    chrome.runtime.onMessage.addListener(
        (message: any, sender: chrome.runtime.MessageSender) => {
            if (message.type === "rpc") {
                contentScriptRpcChannel.message(message.message);
            }
        },
    );

    const contentScriptRpc = createContentScriptRpcClient(
        contentScriptRpcChannel.channel,
    );
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
        scrollUp: async () => {
            return contentScriptRpc.scrollUp();
        },
        scrollDown: async () => {
            return contentScriptRpc.scrollDown();
        },
    };
    const callFunctions: BrowserControlCallFunctions = {
        setAgentStatus: (isBusy: boolean, message: string) => {
            if (isBusy) {
                showBadgeBusy();
            } else {
                showBadgeHealthy();
            }
            console.log(`${message} (isBusy: ${isBusy})`);
        },
    };
    return createRpc(
        "browser:extension",
        channel,
        invokeFunctions,
        callFunctions,
    );
}
