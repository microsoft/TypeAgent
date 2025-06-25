// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { matchLinks, matchLinksByPosition } from "./domUtils";
import { getReadablePageContent } from "./pageContent";
import {
    getPageHTML,
    getPageHTMLSubFragments,
    getPageHTMLFragments,
} from "./htmlProcessing";
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
import { createGenericChannel } from "agent-rpc/channel";
import { ContentScriptRpc } from "../../common/contentScriptRpc/types.mjs";
import { createRpc } from "agent-rpc/rpc";

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
    const contentScriptExtensionChannel = createGenericChannel((message) => {
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
                contentScriptExtensionChannel.message(message.message);
                return false;
            }

            const handleAction = async () => {
                await handleMessage(message, sendResponse);
            };

            handleAction();

            return true; // Indicates we'll send response asynchronously
        },
    );

    const contentScriptChannel = createGenericChannel((message) => {
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
                        contentScriptChannel.message(event.data.body);
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
                const html = getPageHTML(
                    message.fullSize,
                    message.inputHtml,
                    message.frameId,
                    message.useTimestampIds,
                );
                sendResponse(html);
                break;
            }

            case "get_page_text": {
                const text = getPageText(message.inputHtml, message.frameId);
                sendResponse(text);
                break;
            }

            case "get_filtered_html_fragments": {
                const htmlFragments = getPageHTMLSubFragments(
                    message.inputHtml,
                    message.cssSelectors,
                    message.frameId,
                );
                sendResponse(htmlFragments);
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

            case "clearCrosswordPageCache": {
                const value = await localStorage.getItem("pageSchema");
                if (value) {
                    localStorage.removeItem("pageSchema");
                }
                sendResponse({});
                break;
            }

            case "get_page_schema": {
                const value = localStorage.getItem("pageSchema");
                if (value) {
                    sendResponse(JSON.parse(value));
                } else {
                    sendResponse(null);
                }
                break;
            }

            case "set_page_schema": {
                let updatedSchema = message.action.parameters.schema;
                localStorage.setItem(
                    "pageSchema",
                    JSON.stringify(updatedSchema),
                );
                sendResponse({});
                break;
            }

            case "clear_page_schema": {
                const value = localStorage.getItem("pageSchema");
                if (value) {
                    localStorage.removeItem("pageSchema");
                }
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

            default:
                sendResponse({ error: "Unknown message type" });
                break;
        }
    } catch (error) {
        console.error("Error handling message:", error);
        sendResponse({ error: "Error handling message" });
    }
}
