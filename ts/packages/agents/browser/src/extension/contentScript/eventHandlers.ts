// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { matchLinks, matchLinksByPosition } from "./domUtils";
import { getReadablePageContent } from "./pageContent";
import {
    getPageHTML,
    getPageHTMLFragments,
    CompressionMode,
} from "./htmlUtils";
import { getPageText } from "./pageContent";
import {
    getInteractiveElementsBoundingBoxes,
    sendUIEventsRequest,
    sendPaleoDbRequest,
    scrollPageDown,
    scrollPageUp,
} from "./elementInteraction";
import { startRecording, stopRecording } from "./recording";
import {
    extractSchemaMetadata,
    extractSchemaFromLinkedPages,
} from "./schemaExtraction";
import { awaitPageIncrementalUpdates } from "./loadingDetector";
import { createChannelAdapter } from "@typeagent/agent-rpc/channel";
import { ContentScriptRpc } from "../../common/contentScriptRpc/types.mjs";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { sendMessageToBackground, sendMainWorldRequest } from "./messaging";

// Set up history interception for SPA navigation
const interceptHistory = (method: "pushState" | "replaceState") => {
    const original = history[method];
    return function (this: History, ...args: any) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event("spa-navigation"));
        return result;
    };
};

/**
 * Initializes event handlers
 */
export function initializeEventHandlers(): void {
    // Override history methods for SPA detection
    history.pushState = interceptHistory("pushState");
    history.replaceState = interceptHistory("replaceState");

    // Listen for messages from other parts of the extension
    setupMessageListeners();

    // Listen for events from the page
    setupPageEventListeners();
}

/**
 * Sets up message listeners for communication with the extension
 */
function setupMessageListeners(): void {
    const contentScriptExtensionChannel = createChannelAdapter((message) => {
        // Send messages to the background script
        chrome.runtime?.sendMessage({
            type: "rpc",
            message,
        });
    });

    // Listen for messages from the background script
    chrome.runtime?.onMessage.addListener(
        (message: any, sender: chrome.runtime.MessageSender, sendResponse) => {
            if (message.type === "rpc") {
                contentScriptExtensionChannel.notifyMessage(message.message);
                return false;
            }

            if (message.type === "setupCrosswordObserver") {
                // Forward to MAIN world
                sendMainWorldRequest({
                    actionName: "setupCrosswordObserver",
                    parameters: {
                        selectors: message.selectors,
                        texts: message.texts,
                    },
                })
                    .then(() => {
                        sendResponse({ success: true });
                    })
                    .catch((error) => {
                        console.error(
                            "Error installing crossword observer:",
                            error,
                        );
                        sendResponse({ success: false, error: error.message });
                    });
                return true; // Async response
            }

            const handleAction = async () => {
                await handleMessage(message, sendResponse);
            };

            handleAction();

            return true; // Indicates we'll send response asynchronously
        },
    );

    const contentScriptChannel = createChannelAdapter((message) => {
        window.postMessage({
            source: "contentScript",
            target: "preload",
            messageType: "rpc",
            body: message,
        });
    });

    // Listen for messages from content scripts
    window.addEventListener(
        "message",
        async (event) => {
            // Handle preload script messages
            if (
                event.data !== undefined &&
                event.data.source === "preload" &&
                event.data.target === "contentScript"
            ) {
                switch (event.data.messageType) {
                    case "rpc":
                        // Handle RPC messages
                        contentScriptChannel.notifyMessage(event.data.body);
                        break;
                    case "scriptActionRequest":
                        await handleMessage(event.data.body, (response) => {
                            window.top?.postMessage(
                                {
                                    source: "contentScript",
                                    target: "preload",
                                    messageType: "scriptActionResponse",
                                    id: event.data.id,
                                    body: response,
                                },
                                "*",
                            );
                        });
                        break;
                }
            }

            // Handle file path requests
            if (event.data.type === "GET_FILE_PATH" && event.data.fileName) {
                const fileUrl = chrome.runtime.getURL(event.data.fileName);
                window.postMessage(
                    {
                        type: "FILE_PATH_RESULT",
                        result: fileUrl,
                    },
                    "*",
                );
            }
        },
        false,
    );

    const contentScriptRpc: ContentScriptRpc = {
        scrollUp: async () => {
            scrollPageUp();
        },
        scrollDown: async () => {
            scrollPageDown();
        },
        getPageLinksByQuery: async (query: string) => {
            const link = matchLinks(query) as HTMLAnchorElement;
            return link?.href;
        },
        getPageLinksByPosition: async (position: number) => {
            const link = matchLinksByPosition(position) as HTMLAnchorElement;
            return link?.href;
        },
        runPaleoBioDbAction: async (action: any) => {
            sendPaleoDbRequest(action);
        },

        clickOn: async (cssSelector: string) => {
            return await sendUIEventsRequest({
                actionName: "clickOnElement",
                parameters: { cssSelector },
            });
        },
        setDropdown: async (cssSelector: string, optionLabel: string) => {
            return await sendUIEventsRequest({
                actionName: "setDropdownValue",
                parameters: { cssSelector, optionLabel },
            });
        },
        enterTextIn: async (
            textValue: string,
            cssSelector?: string,
            submitForm?: boolean,
        ) => {
            const actionName = cssSelector
                ? "enterTextInElement"
                : "enterTextOnPage";
            return await sendUIEventsRequest({
                actionName,
                parameters: { value: textValue, cssSelector, submitForm },
            });
        },
        awaitPageLoad: async (timeout?: number) => {
            return await awaitPageIncrementalUpdates();
        },
        awaitPageInteraction: async (timeout?: number) => {
            const delay = timeout || 400;
            return new Promise((resolve) => setTimeout(resolve, delay));
        },
    };

    createRpc(
        "browser:content",
        contentScriptChannel.channel,
        contentScriptRpc,
    );
    createRpc(
        "browser:content",
        contentScriptExtensionChannel.channel,
        contentScriptRpc,
    );
}

/**
 * Handles crossword change detection and triggers re-initialization
 * @param url The URL where the change was detected
 */
async function handleCrosswordChanged(url: string): Promise<void> {
    try {
        await sendMessageToBackground({
            type: "enableSiteAgent",
            agentName: "browser.crossword",
            reinitialize: true,
        });
    } catch (error) {
        console.error("Error sending message to background:", error);
    }
}

/**
 * Sets up event listeners for the page
 */
function setupPageEventListeners(): void {
    // Listen for custom events from PaleoDb
    document.addEventListener("fromPaleoDbAutomation", function (e: any) {
        var message = e.detail;
        console.log("received from PaleoDb:", message);
    });

    // Listen for custom events from UI Events Dispatcher
    document.addEventListener(
        "fromUIEventsDispatcher",
        async function (e: any) {
            var message = e.detail;
            console.log("received from UI Events:", message);
        },
    );

    // Listen for crossword automation events
    document.addEventListener(
        "fromCrosswordAutomation",
        async function (e: any) {
            const message = e.detail;
            console.log("Crossword automation event:", message);

            if (message.type === "crosswordChanged") {
                await handleCrosswordChanged(message.url);
            }
        },
    );
}

/**
 * Handles messages from background script and other sources
 * @param message The message to handle
 * @param sendResponse The function to call with the response
 */
export async function handleMessage(
    message: any,
    sendResponse: (response?: any) => void,
): Promise<void> {
    try {
        switch (message.type) {
            case "read_page_content": {
                const article = getReadablePageContent();
                sendResponse(article);
                break;
            }

            case "get_reduced_html": {
                // Determine compression mode from new parameter or legacy fullSize
                let compressionMode: CompressionMode;
                let shouldFilterToReadingView = message.filterToReadingView;

                if (message.compressionMode) {
                    // CompressionMode parameter takes precedence
                    compressionMode =
                        message.compressionMode as CompressionMode;
                    // Enforce readable view when compressionMode is explicitly passed
                    shouldFilterToReadingView = true;
                } else {
                    compressionMode = message.fullSize
                        ? CompressionMode.None
                        : CompressionMode.Automation;
                }

                const html = getPageHTML(
                    compressionMode,
                    message.inputHtml,
                    message.frameId,
                    message.useTimestampIds,
                    shouldFilterToReadingView,
                    message.keepMetaTags,
                );
                sendResponse(html);
                break;
            }

            case "get_page_text": {
                const text = getPageText(message.inputHtml, message.frameId);
                sendResponse(text);
                break;
            }

            case "get_maxSize_html_fragments": {
                const htmlFragments = getPageHTMLFragments(
                    message.inputHtml,
                    message.frameId,
                    message.useTimestampIds,
                    message.maxFragmentSize,
                );
                sendResponse(htmlFragments);
                break;
            }

            case "get_element_bounding_boxes": {
                const boundingBoxes = getInteractiveElementsBoundingBoxes();
                sendResponse(boundingBoxes);
                break;
            }

            case "await_page_incremental_load": {
                const updated = await awaitPageIncrementalUpdates();
                sendResponse(updated);
                break;
            }

            case "run_ui_event": {
                await sendUIEventsRequest(message.action);
                sendResponse({});
                break;
            }

            case "startRecording": {
                await startRecording();
                sendResponse({});
                break;
            }

            case "stopRecording": {
                const result = await stopRecording();
                sendResponse(result);
                break;
            }

            case "extractSchemaCurrentPage": {
                const metadata = extractSchemaMetadata();
                if (metadata.length > 0) {
                    const data = {
                        url: window.location.href,
                        data: metadata,
                    };

                    chrome.runtime.sendMessage({
                        type: "downloadData",
                        data,
                        filename: `schema-${new URL(window.location.href).hostname}-${Date.now()}.json`,
                    });
                } else {
                    alert("No schema.org metadata found on this page.");
                }

                sendResponse({});
                break;
            }

            case "extractSchemaLinkedPages": {
                extractSchemaFromLinkedPages();
                sendResponse({});
                break;
            }

            case "setupCrosswordObserver": {
                console.log(
                    "Received request to install crossword observer with selectors:",
                    message.selectors,
                    "and texts:",
                    message.texts,
                );
                // Forward to MAIN world
                sendMainWorldRequest({
                    actionName: "setupCrosswordObserver",
                    parameters: {
                        selectors: message.selectors,
                        texts: message.texts,
                    },
                });
                break;
            }

            case "get_image_url": {
                try {
                    let imgElement: HTMLImageElement | null = null;

                    // Try CSS selector first if provided
                    if (message.cssSelector) {
                        const element = document.querySelector(
                            message.cssSelector,
                        );
                        if (element instanceof HTMLImageElement) {
                            imgElement = element;
                        } else {
                            sendResponse({
                                error: `Element found with selector '${message.cssSelector}' is not an image`,
                            });
                            return;
                        }
                    }
                    // Try finding by description if provided
                    else if (message.imageDescription) {
                        // Simple heuristic: find images with matching alt text or title
                        const images = Array.from(
                            document.querySelectorAll("img"),
                        );
                        const description =
                            message.imageDescription.toLowerCase();
                        imgElement =
                            images.find(
                                (img) =>
                                    img.alt
                                        ?.toLowerCase()
                                        .includes(description) ||
                                    img.title
                                        ?.toLowerCase()
                                        .includes(description),
                            ) || null;

                        if (!imgElement) {
                            sendResponse({
                                error: `No image found matching description: ${message.imageDescription}`,
                            });
                            return;
                        }
                    } else {
                        sendResponse({
                            error: "Either cssSelector or imageDescription must be provided",
                        });
                        return;
                    }

                    if (!imgElement) {
                        sendResponse({ error: "Image not found" });
                        return;
                    }

                    // Get the image URL (handle both src and srcset)
                    const imageUrl = imgElement.currentSrc || imgElement.src;

                    if (!imageUrl) {
                        sendResponse({ error: "Image has no source URL" });
                        return;
                    }

                    // Convert relative URLs to absolute
                    const absoluteUrl = new URL(imageUrl, window.location.href)
                        .href;

                    sendResponse({ imageUrl: absoluteUrl });
                } catch (error: any) {
                    sendResponse({
                        error: `Error getting image URL: ${error.message}`,
                    });
                }
                break;
            }

            default:
                sendResponse({ error: "Unknown message type" });
                break;
        }
    } catch (error) {
        console.error("Error handling message:", error);
        sendResponse({ error: "Error handling message" });
    }
}
