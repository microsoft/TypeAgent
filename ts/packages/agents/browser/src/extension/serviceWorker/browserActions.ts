// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAction } from "./types";
import {
    getActiveTab,
    getTabByTitle,
    awaitPageLoad,
    awaitPageIncrementalUpdates,
} from "./tabManager";
import {
    getTabScreenshot,
    getTabAnnotatedScreenshot,
    getTabHTMLFragments,
    getFilteredHTMLFragments,
} from "./capture";

/**
 * Executes a browser action
 * @param action The action to execute
 * @returns Promise resolving to the result of the action
 */
export async function runBrowserAction(action: AppAction): Promise<any> {
    let responseObject = undefined;
    let confirmationMessage = "OK";
    const actionName =
        action.actionName ?? action.fullActionName?.split(".").at(-1);

    switch (actionName) {
        case "openTab": {
            if (action.parameters.url) {
                const tab = await chrome.tabs.create({
                    url: action.parameters.url,
                });

                await awaitPageLoad(tab);

                confirmationMessage = `Opened new tab to ${action.parameters.url}`;
            } else {
                if (action.parameters?.query) {
                    await chrome.search.query({
                        disposition: "NEW_TAB",
                        text: action.parameters.query,
                    });

                    confirmationMessage = `Opened new tab with query ${action.parameters.query}`;
                } else {
                    await chrome.tabs.create({});
                    confirmationMessage = "Opened new tab";
                }
            }

            break;
        }
        case "closeTab": {
            let targetTab: chrome.tabs.Tab | undefined = undefined;
            if (action.parameters?.title) {
                targetTab = await getTabByTitle(action.parameters.title);
            } else {
                targetTab = await getActiveTab();
            }

            if (targetTab && targetTab.id) {
                await chrome.tabs.remove(targetTab.id);
            }
            confirmationMessage = "Closed tab";
            break;
        }
        case "switchToTabByText": {
            const targetTab = await getTabByTitle(action.parameters.keywords);
            if (targetTab) {
                await chrome.tabs.update(targetTab.id!, {
                    active: true,
                });

                confirmationMessage = "Switched to tab";
            }

            break;
        }
        case "search": {
            await chrome.search.query({
                disposition: "NEW_TAB",
                text: action.parameters.query,
            });

            confirmationMessage = `Opened new tab with query ${action.parameters.query}`;
            break;
        }

        case "openFromHistory": {
            const targetTab = await getActiveTab();
            const historyItems = await chrome.history.search({
                text: action.parameters.keywords,
                maxResults: 1,
            });

            if (historyItems && historyItems.length > 0) {
                console.log(historyItems);
                if (targetTab?.id) {
                    chrome.tabs.update(targetTab.id, {
                        url: historyItems[0].url,
                    });
                } else {
                    chrome.tabs.create({
                        url: historyItems[0].url,
                    });
                }
            }

            break;
        }
        case "openFromBookmarks": {
            const OpenFromBookmarksItems = await chrome.bookmarks.search({
                query: action.parameters.keywords,
            });

            if (
                OpenFromBookmarksItems &&
                OpenFromBookmarksItems.length > 0 &&
                OpenFromBookmarksItems[0].url
            ) {
                console.log(OpenFromBookmarksItems);
                await chrome.tabs.create({
                    url: OpenFromBookmarksItems[0].url,
                });
            }

            break;
        }
        case "readPage": {
            const targetTab = await getActiveTab();
            const article = await chrome.tabs.sendMessage(targetTab?.id!, {
                type: "read_page_content",
            });

            if (article.error) {
                confirmationMessage = article.error;
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

            console.log(article);
            break;
        }
        case "stopReadPage": {
            chrome.tts.stop();
            break;
        }

        case "captureScreenshot": {
            responseObject = await getTabScreenshot(
                action.parameters?.downloadAsFile,
            );
            break;
        }
        case "captureAnnotatedScreenshot": {
            responseObject = await getTabAnnotatedScreenshot(
                action.parameters?.downloadAsFile,
            );
            break;
        }
        case "getHTML": {
            const targetTab = await getActiveTab();

            responseObject = await getTabHTMLFragments(
                targetTab!,
                action.parameters?.fullHTML,
                action.parameters?.downloadAsFile,
                action.parameters?.extractText,
                action.parameters?.useTimestampIds,
            );
            break;
        }
        case "getFilteredHTMLFragments": {
            const targetTab = await getActiveTab();

            responseObject = await getFilteredHTMLFragments(
                targetTab!,
                action.parameters.fragments,
                action.parameters.cssSelectorsToKeep,
            );
            break;
        }
        case "awaitPageLoad": {
            const targetTab = await getActiveTab();
            await awaitPageLoad(targetTab!);
            await awaitPageIncrementalUpdates(targetTab!);
            responseObject = targetTab?.url;
            break;
        }
        case "clickOnElement": {
            const targetTab = await getActiveTab();
            const response = await chrome.tabs.sendMessage(targetTab?.id!, {
                type: "run_ui_event",
                action: action,
            });
            break;
        }
        case "enterTextInElement": {
            const targetTab = await getActiveTab();
            const response = await chrome.tabs.sendMessage(targetTab?.id!, {
                type: "run_ui_event",
                action: action,
            });
            break;
        }
        case "enterTextOnPage": {
            const targetTab = await getActiveTab();
            const response = await chrome.tabs.sendMessage(targetTab?.id!, {
                type: "run_ui_event",
                action: action,
            });
            break;
        }
        case "setDropdownValue": {
            const targetTab = await getActiveTab();
            const response = await chrome.tabs.sendMessage(targetTab?.id!, {
                type: "run_ui_event",
                action: action,
            });
            break;
        }
        case "getActionsForUrl": {
            // Enhanced action retrieval with ActionsStore support
            responseObject = await chrome.runtime.sendMessage({
                type: "getActionsForUrl",
                url: action.parameters.url,
                includeGlobal: action.parameters.includeGlobal,
                author: action.parameters.author,
            });
            break;
        }

        case "recordActionUsage": {
            // Record action usage for analytics
            responseObject = await chrome.runtime.sendMessage({
                type: "recordActionUsage",
                actionId: action.parameters.actionId,
            });
            break;
        }
        default:
            throw new Error(`Unknown action: ${actionName}. `);
    }

    return {
        message: confirmationMessage,
        data: responseObject,
    };
}
