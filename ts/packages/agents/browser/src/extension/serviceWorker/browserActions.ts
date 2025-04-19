// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAction } from "./types";
import { getActiveTab, getTabByTitle, awaitPageLoad, awaitPageIncrementalUpdates, downloadStringAsFile, downloadImageAsFile } from "./tabManager";
import { getTabScreenshot, getTabAnnotatedScreenshot, getTabHTMLFragments, getFilteredHTMLFragments } from "./capture";
import { getPageSchema, setPageSchema, getStoredPageProperty, setStoredPageProperty } from "./storage";
import { showBadgeHealthy } from "./ui";

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
        case "followLinkByText": {
            const targetTab = await getActiveTab();
            const response = await chrome.tabs.sendMessage(targetTab?.id!, {
                type: "get_page_links_by_query",
                query: action.parameters.keywords,
            });

            if (response && response.url) {
                if (action.parameters.openInNewTab) {
                    await chrome.tabs.create({
                        url: response.url,
                    });
                } else {
                    await chrome.tabs.update(targetTab?.id!, {
                        url: response.url,
                    });
                }

                confirmationMessage = `Navigated to the ${action.parameters.keywords} link`;
            }

            break;
        }
        case "followLinkByPosition": {
            const targetTab = await getActiveTab();
            const response = await chrome.tabs.sendMessage(targetTab?.id!, {
                type: "get_page_links_by_position",
                position: action.parameters.position,
            });

            if (response && response.url) {
                if (action.parameters.openInNewTab) {
                    await chrome.tabs.create({
                        url: response.url,
                    });
                } else {
                    await chrome.tabs.update(targetTab?.id!, {
                        url: response.url,
                    });
                }

                confirmationMessage = `Navigated to the ${action.parameters.position} link`;
            }

            break;
        }
        case "scrollDown": {
            const targetTab = await getActiveTab();
            await chrome.tabs.sendMessage(targetTab?.id!, {
                type: "scroll_down_on_page",
            });
            break;
        }
        case "scrollUp": {
            const targetTab = await getActiveTab();
            await chrome.tabs.sendMessage(targetTab?.id!, {
                type: "scroll_up_on_page",
            });
            break;
        }
        case "goBack": {
            const targetTab = await getActiveTab();
            await chrome.tabs.goBack(targetTab?.id!);
            break;
        }
        case "goForward": {
            const targetTab = await getActiveTab();
            await chrome.tabs.goForward(targetTab?.id!);
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

            if (OpenFromBookmarksItems && OpenFromBookmarksItems.length > 0 && OpenFromBookmarksItems[0].url) {
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
        case "zoomIn": {
            const targetTab = await getActiveTab();
            if (targetTab?.url?.startsWith("https://paleobiodb.org/")) {
                const result = await chrome.tabs.sendMessage(targetTab.id!, {
                    type: "run_paleoBioDb_action",
                    action: action,
                });
            } else {
                const currentZoom = await chrome.tabs.getZoom();
                if (currentZoom < 5) {
                    var stepValue = 1;
                    if (currentZoom < 2) {
                        stepValue = 0.25;
                    }

                    await chrome.tabs.setZoom(currentZoom + stepValue);
                }
            }

            break;
        }
        case "zoomOut": {
            const targetTab = await getActiveTab();
            if (targetTab?.url?.startsWith("https://paleobiodb.org/")) {
                const result = await chrome.tabs.sendMessage(targetTab.id!, {
                    type: "run_paleoBioDb_action",
                    action: action,
                });
            } else {
                const currentZoom = await chrome.tabs.getZoom();
                if (currentZoom > 0) {
                    var stepValue = 1;
                    if (currentZoom < 2) {
                        stepValue = 0.25;
                    }

                    await chrome.tabs.setZoom(currentZoom - stepValue);
                }
            }
            break;
        }
        case "zoomReset": {
            await chrome.tabs.setZoom(0);
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
        case "getPageUrl": {
            const targetTab = await getActiveTab();
            responseObject = targetTab?.url;
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
        case "getPageSchema": {
            const targetTab = await getActiveTab();
            const key = action.parameters.url ?? targetTab?.url;
            if (key) {
                responseObject = await getPageSchema(key);
                if (responseObject) {
                    showBadgeHealthy();
                }
            }
            break;
        }
        case "setPageSchema": {
            const key = action.parameters.url;
            if (key) {
                await setPageSchema(key, action.parameters.schema);
            }
            break;
        }
        case "getPageStoredProperty": {
            responseObject = await getStoredPageProperty(
                action.parameters.url,
                action.parameters.key,
            );
            break;
        }
        case "setPageStoredProperty": {
            await setStoredPageProperty(
                action.parameters.url,
                action.parameters.key,
                action.parameters.value,
            );
            break;
        }
    }

    return {
        message: confirmationMessage,
        data: responseObject,
    };
}