// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createGenericChannel,
    GenericChannel,
    RpcChannel,
} from "agent-rpc/channel";
import { getActiveTab } from "./tabManager";
import { createRpc } from "agent-rpc/rpc";
import {
    BrowserControlCallFunctions,
    BrowserControlInvokeFunctions,
} from "../../common/browserControl.mjs";
import { showBadgeBusy, showBadgeHealthy } from "./ui";
import { createContentScriptRpcClient } from "../../common/contentScriptRpc/client.mjs";
import { ContentScriptRpc } from "../../common/contentScriptRpc/types.mjs";

async function ensureActiveTab() {
    const targetTab = await getActiveTab();
    if (!targetTab || targetTab.id === undefined) {
        throw new Error("No active tab found.");
    }
    return targetTab;
}
export function createExternalBrowserServer(channel: RpcChannel) {
    const rpcMap = new Map<
        number,
        { channel: GenericChannel; contentScriptRpc: ContentScriptRpc }
    >();

    chrome.tabs.onRemoved.addListener((tabId) => {
        const entry = rpcMap.get(tabId);
        if (entry) {
            entry.channel.disconnect();
            rpcMap.delete(tabId);
        }
    });

    function getContentScriptRpc(tabId: number) {
        const entry = rpcMap.get(tabId);
        if (entry) {
            return entry.contentScriptRpc;
        }

        const contentScriptRpcChannel = createGenericChannel(
            async (message, cb) => {
                try {
                    await chrome.tabs.sendMessage(tabId, {
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
        const contentScriptRpc = createContentScriptRpcClient(
            contentScriptRpcChannel.channel,
        );

        rpcMap.set(tabId, {
            channel: contentScriptRpcChannel,
            contentScriptRpc,
        });
        return contentScriptRpc;
    }

    async function getActiveTabRpc() {
        const targetTab = await ensureActiveTab();
        return getContentScriptRpc(targetTab.id!);
    }

    chrome.runtime.onMessage.addListener(
        (message: any, sender: chrome.runtime.MessageSender) => {
            if (message.type === "rpc") {
                const tabId = sender.tab?.id;
                if (tabId) {
                    rpcMap.get(tabId)?.channel.message(message.message);
                }
            }
        },
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
            const targetTab = await ensureActiveTab();
            await chrome.tabs.remove(targetTab.id!);
        },
        goForward: async () => {
            const targetTab = await ensureActiveTab();
            await chrome.tabs.goForward(targetTab.id!);
        },
        goBack: async () => {
            const targetTab = await ensureActiveTab();
            await chrome.tabs.goBack(targetTab.id!);
        },
        reload: async () => {
            const targetTab = await ensureActiveTab();
            await chrome.tabs.reload(targetTab.id!);
        },
        getPageUrl: async () => {
            const targetTab = await ensureActiveTab();

            const url = targetTab.url;
            if (url) {
                return url;
            }
            throw new Error("Unable to to retrieve URL from the active tab.");
        },
        scrollUp: async () => {
            return (await getActiveTabRpc()).scrollUp();
        },
        scrollDown: async () => {
            return (await getActiveTabRpc()).scrollDown();
        },
        zoomIn: async () => {
            const targetTab = await ensureActiveTab();

            if (targetTab.url?.startsWith("https://paleobiodb.org/")) {
                const contentScriptRpc = await getContentScriptRpc(
                    targetTab.id!,
                );
                return contentScriptRpc.runPaleoBioDbAction({
                    actionName: "zoomIn",
                });
            }
            const currentZoom = await chrome.tabs.getZoom(targetTab.id!);
            await chrome.tabs.setZoom(targetTab.id!, currentZoom + 0.1);
        },
        zoomOut: async () => {
            const targetTab = await ensureActiveTab();
            if (targetTab.url?.startsWith("https://paleobiodb.org/")) {
                const contentScriptRpc = await getContentScriptRpc(
                    targetTab.id!,
                );
                return contentScriptRpc.runPaleoBioDbAction({
                    actionName: "zoomOut",
                });
            }

            const currentZoom = await chrome.tabs.getZoom(targetTab.id!);
            await chrome.tabs.setZoom(targetTab.id!, currentZoom - 0.1);
        },
        zoomReset: async () => {
            const targetTab = await ensureActiveTab();
            await chrome.tabs.setZoom(targetTab.id!, 0);
        },
        followLinkByText: async (keywords: string, openInNewTab?: boolean) => {
            const targetTab = await ensureActiveTab();
            const contentScriptRpc = await getContentScriptRpc(targetTab.id!);
            const url = await contentScriptRpc.getPageLinksByQuery(keywords);

            if (url) {
                if (openInNewTab) {
                    await chrome.tabs.create({ url });
                } else {
                    await chrome.tabs.update(targetTab.id!, { url });
                }
            }

            return url;
        },
        followLinkByPosition: async (position, openInNewTab) => {
            const targetTab = await ensureActiveTab();
            const contentScriptRpc = await getContentScriptRpc(targetTab.id!);
            const url = await contentScriptRpc.getPageLinksByPosition(position);

            if (url) {
                if (openInNewTab) {
                    await chrome.tabs.create({
                        url,
                    });
                } else {
                    await chrome.tabs.update(targetTab.id!, { url });
                }
            }

            return url;
        },

        closeWindow: async () => {
            const current = await chrome.windows.getCurrent();
            if (current.id) {
                await chrome.windows.remove(current.id);
            } else {
                throw new Error("No current window found to close.");
            }
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
