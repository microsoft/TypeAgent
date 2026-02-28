// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createChannelAdapter,
    ChannelAdapter,
    RpcChannel,
} from "@typeagent/agent-rpc/channel";
import { getActiveTab, downloadImageAsFile } from "./tabManager";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import {
    BrowserControlCallFunctions,
    BrowserControlInvokeFunctions,
    BrowserSettings,
} from "../../common/browserControl.mjs";
import { showBadgeBusy, showBadgeHealthy } from "./ui";
import { createContentScriptRpcClient } from "../../common/contentScriptRpc/client.mjs";
import { ContentScriptRpc } from "../../common/contentScriptRpc/types.mjs";
import { getTabHTMLFragments, CompressionMode } from "./capture";
import { screenshotCoordinator } from "./screenshotCoordinator";
//import { generateEmbedding, indexesOfNearest, NormalizedEmbedding, SimilarityType } from "../../../../../typeagent/dist/indexNode";
//import { openai } from "aiclient";

async function ensureActiveTab() {
    const targetTab = await getActiveTab();
    if (!targetTab || targetTab.id === undefined) {
        throw new Error(
            "No browser tabs are currently open. Please open a browser tab to continue.",
        );
    }
    return targetTab;
}
export function createExternalBrowserServer(channel: RpcChannel) {
    const rpcMap = new Map<
        number,
        { channel: ChannelAdapter; contentScriptRpc: ContentScriptRpc }
    >();

    chrome.tabs.onRemoved.addListener((tabId) => {
        const entry = rpcMap.get(tabId);
        if (entry) {
            entry.channel.notifyDisconnected();
            rpcMap.delete(tabId);
        }
    });

    /**
     * Inject content scripts into a tab programmatically.
     * This is needed when the extension is reloaded and existing tabs
     * don't have the content scripts from the manifest.
     */
    async function injectContentScripts(tabId: number): Promise<void> {
        await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ["contentScript.js"],
        });
    }

    function getContentScriptRpc(tabId: number) {
        const entry = rpcMap.get(tabId);
        if (entry) {
            return entry.contentScriptRpc;
        }

        // Target frameId 0 (main frame) to avoid race conditions where
        // multiple frames respond to the same RPC and the wrong one wins.
        const sendOptions = { frameId: 0 };

        const contentScriptRpcChannel = createChannelAdapter(
            async (message, cb) => {
                try {
                    await chrome.tabs.sendMessage(
                        tabId,
                        { type: "rpc", message },
                        sendOptions,
                    );
                } catch (error: any) {
                    // If the content script isn't loaded, inject it and retry
                    const errMsg =
                        typeof error === "string"
                            ? error
                            : (error?.message ?? "");
                    if (
                        errMsg.includes("Could not establish connection") ||
                        errMsg.includes("Receiving end does not exist")
                    ) {
                        try {
                            await injectContentScripts(tabId);
                            // Small delay to let the content script initialize
                            await new Promise((r) => setTimeout(r, 100));
                            await chrome.tabs.sendMessage(
                                tabId,
                                { type: "rpc", message },
                                sendOptions,
                            );
                            return;
                        } catch (retryError) {
                            console.error(
                                "Error after injecting content script:",
                                retryError,
                            );
                            if (cb) {
                                cb(retryError as Error);
                            }
                            return;
                        }
                    }
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

    function resolveCustomProtocolUrl(url: string): string {
        // Handle typeagent-browser custom protocol
        if (url.startsWith("typeagent-browser://")) {
            const customUrl = new URL(url);
            const customPath = customUrl.pathname;
            const queryString = customUrl.search;

            // Map custom protocol to actual extension URL
            const libraryMapping: Record<string, string> = {
                "/annotationsLibrary.html": "views/annotationsLibrary.html",
                "/knowledgeLibrary.html": "views/knowledgeLibrary.html",
                "/macrosLibrary.html": "views/macrosLibrary.html",
                "/entityGraphView.html": "views/entityGraphView.html",
                "/topicGraphView.html": "views/topicGraphView.html",
            };

            const extensionPath = libraryMapping[customPath];
            if (extensionPath) {
                // Append query parameters to preserve entity/topic selection
                return chrome.runtime.getURL(extensionPath) + queryString;
            } else {
                throw new Error(`Unknown library page: ${customPath}`);
            }
        }

        return url;
    }

    chrome.runtime.onMessage.addListener(
        (message: any, sender: chrome.runtime.MessageSender) => {
            if (message.type === "rpc") {
                const tabId = sender.tab?.id;
                if (tabId) {
                    rpcMap.get(tabId)?.channel.notifyMessage(message.message);
                }
            }
        },
    );

    const invokeFunctions: BrowserControlInvokeFunctions = {
        openWebPage: async (url: string, options?: { newTab?: boolean }) => {
            // Resolve custom protocol URLs to actual extension URLs
            const resolvedUrl = resolveCustomProtocolUrl(url);

            const targetTab = await getActiveTab();
            if (targetTab && !options?.newTab) {
                await chrome.tabs.update(targetTab.id!, { url: resolvedUrl });
            } else {
                await chrome.tabs.create({ url: resolvedUrl });
            }
        },
        closeWebPage: async () => {
            const targetTab = await ensureActiveTab();
            await chrome.tabs.remove(targetTab.id!);
        },
        closeAllWebPages: async () => {
            let tab: chrome.tabs.Tab | undefined = undefined;
            do {
                tab = await chrome.tabs.getCurrent();
                if (tab) {
                    await chrome.tabs.remove(tab.id!);
                }
            } while (tab);
        },
        switchTabs: async (
            tabDescription: string,
            tabIndex?: number,
        ): Promise<boolean> => {
            console.log(
                `Tab switch requested: '${tabDescription}', index: ${tabIndex}`,
            );

            // 08.22.2025 - robgruen - This code will not work as is since the imports
            // for the embedding model are supported by the vite compiler since that pulls
            // in dependencies that aren't supported.  For now we will only support this in
            // the inline browser experience.
            // const ids: string[] = [];
            // const score_threshold = 0.85;
            // const titleEmbedding: NormalizedEmbedding[] = [];
            // const urlEmbedding: NormalizedEmbedding[] = [];
            //  const embeddingModel = openai.createEmbeddingModel();
            // const queryEmbedding = await generateEmbedding(embeddingModel, tabDescription);

            // const tabData: any[] = [];
            // chrome.tabs.query({}, function(tabs) {
            //     tabs.forEach((tab) => {
            //         console.log(`Tab ID: ${tab.id}, Title: ${tab.title}, URL: ${tab.url}`);
            //         tabData.push({
            //             id: tab.id,
            //             title: tab.title,
            //             url: tab.url
            //         });
            //     });
            // });

            // for (let i = 0; i < tabData.length; i++) {
            //     const tab = tabData[i];
            //     ids.push(tab.id.toString());
            //     titleEmbedding.push(await generateEmbedding(embeddingModel, tab.title));
            //     urlEmbedding.push(await generateEmbedding(embeddingModel, tab.url));
            // }

            // const topNTitle = indexesOfNearest(titleEmbedding, queryEmbedding, 1, SimilarityType.Dot);
            // const topNUrl = indexesOfNearest(urlEmbedding, queryEmbedding, 1, SimilarityType.Dot);

            // const idx = topNTitle[0].score > topNUrl[0].score ? topNTitle[0].item : topNUrl[0].item;
            // const maxScore = Math.max(topNTitle[0].score, topNUrl[0].score);

            // if (maxScore < score_threshold) {
            //     throw new Error(`No matching tabs found for '${tabDescription}'.`);
            // }

            // await chrome.tabs.update(tabData[idx].id!, { active: true });
            return false;
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
            console.log(
                `[followLinkByText] keywords="${keywords}" tabId=${targetTab.id} tabUrl="${targetTab.url}"`,
            );
            const contentScriptRpc = await getContentScriptRpc(targetTab.id!);
            const url = await contentScriptRpc.getPageLinksByQuery(keywords);
            console.log(
                `[followLinkByText] content script returned url="${url}"`,
            );

            if (url) {
                const resolvedUrl = resolveCustomProtocolUrl(url);
                console.log(
                    `[followLinkByText] resolvedUrl="${resolvedUrl}" openInNewTab=${openInNewTab}`,
                );
                if (openInNewTab) {
                    await chrome.tabs.create({ url: resolvedUrl });
                } else {
                    console.log(
                        `[followLinkByText] navigating tab ${targetTab.id} to "${resolvedUrl}" via scripting`,
                    );
                    // Use window.location.href instead of chrome.tabs.update
                    // so the navigation creates a proper history entry (goBack works).
                    await chrome.scripting.executeScript({
                        target: { tabId: targetTab.id! },
                        func: (url: string) => {
                            window.location.href = url;
                        },
                        args: [resolvedUrl],
                    });
                    console.log(
                        `[followLinkByText] navigation script injected`,
                    );
                }
            } else {
                console.log(
                    `[followLinkByText] No URL returned from content script`,
                );
            }

            return url;
        },
        followLinkByPosition: async (position, openInNewTab) => {
            const targetTab = await ensureActiveTab();
            const contentScriptRpc = await getContentScriptRpc(targetTab.id!);
            const url = await contentScriptRpc.getPageLinksByPosition(position);

            if (url) {
                const resolvedUrl = resolveCustomProtocolUrl(url);
                if (openInNewTab) {
                    await chrome.tabs.create({
                        url: resolvedUrl,
                    });
                } else {
                    await chrome.tabs.update(targetTab.id!, {
                        url: resolvedUrl,
                    });
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

        search: async (
            query?: string,
            sites?: string[],
            searchProvider?: any,
            options?: { waitForPageLoad?: boolean; newTab?: boolean },
        ): Promise<URL> => {
            // Use the search provider URL template if provided
            let searchUrl: string;
            if (searchProvider?.url) {
                searchUrl = searchProvider.url.replace(
                    "%s",
                    encodeURIComponent(query || ""),
                );
            } else {
                // Default to Bing search
                searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query || "")}`;
            }

            // If sites are specified, add site: operator to the query
            if (sites && sites.length > 0) {
                const siteQuery = sites.map((s) => `site:${s}`).join(" OR ");
                const separator = searchUrl.includes("?") ? "&" : "?";
                searchUrl =
                    searchUrl +
                    separator +
                    `q=${encodeURIComponent(`${query} (${siteQuery})`)}`;
            }

            const disposition = options?.newTab ? "NEW_TAB" : "CURRENT_TAB";
            await chrome.tabs.update({ url: searchUrl });

            return new URL(searchUrl);
        },
        readPageContent: async () => {
            const targetTab = await getActiveTab();
            const article = await chrome.tabs.sendMessage(targetTab?.id!, {
                type: "read_page_content",
            });

            if (article.error) {
                throw new Error(article.error);
            }

            if (article?.title) {
                chrome.tts.speak(article?.title, { lang: article?.lang });
            }

            if (article?.formattedText) {
                const lines = article.formattedText as string[];
                lines.forEach((line) => {
                    chrome.tts.speak(line, {
                        lang: article?.lang,
                        enqueue: true,
                    });
                });
            }
        },
        stopReadPageContent: async () => {
            chrome.tts.stop();
        },
        captureScreenshot: async () => {
            const targetTab = await ensureActiveTab();
            return screenshotCoordinator.captureScreenshot({
                tabId: targetTab.id,
            });
        },
        getPageTextContent: async (): Promise<string> => {
            const targetTab = await getActiveTab();
            const article = await chrome.tabs.sendMessage(targetTab?.id!, {
                type: "read_page_content",
            });

            if (article.error) {
                throw new Error(article.error);
            }

            if (article?.formattedText) {
                return article.formattedText;
            }

            throw new Error("No formatted text found.");
        },
        getAutoIndexSetting: async (): Promise<boolean> => {
            try {
                const result = await chrome.storage.sync.get(["autoIndexing"]);
                return result.autoIndexing === true;
            } catch (error) {
                console.error("Failed to get autoIndex setting:", error);
                return false;
            }
        },
        getBrowserSettings: async () => {
            try {
                const result = await chrome.storage.sync.get([
                    "autoIndexing",
                    "extractionMode",
                ]);

                return {
                    autoIndexing: result.autoIndexing === true,
                    extractionMode: result.extractionMode || "content",
                };
            } catch (error) {
                console.error("Failed to get browser settings:", error);
                return {
                    autoIndexing: false,
                    extractionMode: "content",
                };
            }
        },

        getHtmlFragments: async (
            useTimestampIds?: boolean,
            compressionMode?: string,
        ) => {
            const targetTab = await ensureActiveTab();

            // Convert string compressionMode to CompressionMode enum, default to Automation
            const mode =
                compressionMode === "None"
                    ? CompressionMode.None
                    : compressionMode === "knowledgeExtraction"
                      ? CompressionMode.KnowledgeExtraction
                      : CompressionMode.Automation;

            // For knowledge extraction, disable text extraction since textpro will handle HTML-to-markdown conversion
            const shouldExtractText = compressionMode !== "knowledgeExtraction";

            return getTabHTMLFragments(
                targetTab!,
                mode,
                false,
                shouldExtractText,
                useTimestampIds,
            );
        },
        clickOn: async (cssSelector: string) => {
            const targetTab = await ensureActiveTab();
            const contentScriptRpc = await getContentScriptRpc(targetTab.id!);
            return contentScriptRpc.clickOn(cssSelector);
        },
        setDropdown: async (cssSelector: string, optionLabel: string) => {
            const targetTab = await ensureActiveTab();
            const contentScriptRpc = await getContentScriptRpc(targetTab.id!);
            return contentScriptRpc.setDropdown(cssSelector, optionLabel);
        },
        enterTextIn: async (
            textValue: string,
            cssSelector?: string,
            submitForm?: boolean,
        ) => {
            const targetTab = await ensureActiveTab();
            const contentScriptRpc = await getContentScriptRpc(targetTab.id!);
            return contentScriptRpc.enterTextIn(
                textValue,
                cssSelector,
                submitForm,
            );
        },
        awaitPageLoad: async (timeout?: number) => {
            const targetTab = await ensureActiveTab();
            const contentScriptRpc = await getContentScriptRpc(targetTab.id!);
            return contentScriptRpc.awaitPageLoad(timeout);
        },
        awaitPageInteraction: async (timeout?: number) => {
            const targetTab = await ensureActiveTab();
            const contentScriptRpc = await getContentScriptRpc(targetTab.id!);
            return contentScriptRpc.awaitPageInteraction(timeout);
        },
        downloadImage: async (
            cssSelector?: string,
            imageDescription?: string,
            filename?: string,
        ): Promise<string> => {
            const targetTab = await ensureActiveTab();

            const response = await chrome.tabs.sendMessage(targetTab.id!, {
                type: "get_image_url",
                cssSelector,
                imageDescription,
            });

            if (response?.error) {
                throw new Error(response.error);
            }

            const imageUrl: string = response?.imageUrl;
            if (!imageUrl) {
                throw new Error("No image URL returned from content script");
            }

            // Fetch image and trigger browser download via the tab
            const imgResponse = await fetch(imageUrl);
            const arrayBuffer = await imgResponse.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const contentType =
                imgResponse.headers.get("content-type") || "image/png";
            const dataUrl = `data:${contentType};base64,${btoa(binary)}`;

            const resolvedFilename = filename || `image_${Date.now()}.png`;
            await downloadImageAsFile(targetTab, dataUrl, resolvedFilename);
            return resolvedFilename;
        },
        //};
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
