// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BoundingBox, HTMLFragment } from "./types";
import {
    downloadStringAsFile,
} from "./tabManager";

/**
 * Gets HTML fragments from a tab
 * @param targetTab The tab to get fragments from
 * @param fullSize Whether to get the full HTML
 * @param downloadAsFile Whether to download the HTML as a file
 * @param extractText Whether to extract text from the HTML
 * @param useTimestampIds Whether to use timestamp IDs
 * @param filterToReadingView Whether to apply readability filter
 * @param keepMetaTags Whether to preserve meta tags when using readability
 * @returns Promise resolving to an array of HTML fragments
 */
export async function getTabHTMLFragments(
    targetTab: chrome.tabs.Tab,
    fullSize?: boolean,
    downloadAsFile?: boolean,
    extractText?: boolean,
    useTimestampIds?: boolean,
    filterToReadingView?: boolean,
    keepMetaTags?: boolean,
): Promise<HTMLFragment[]> {
    const frames = await chrome.webNavigation.getAllFrames({
        tabId: targetTab.id!,
    });
    let htmlFragments: HTMLFragment[] = [];
    if (frames) {
        for (let i = 0; i < frames?.length; i++) {
            if (frames[i].url == "about:blank") {
                continue;
            }
            try {
                const frameHTML = await chrome.tabs.sendMessage(
                    targetTab.id!,
                    {
                        type: "get_reduced_html",
                        fullSize: fullSize,
                        frameId: frames[i].frameId,
                        useTimestampIds: useTimestampIds,
                        filterToReadingView: filterToReadingView,
                        keepMetaTags: keepMetaTags,
                    },
                    { frameId: frames[i].frameId },
                );

                if (frameHTML) {
                    let frameText = "";
                    if (extractText) {
                        frameText = await chrome.tabs.sendMessage(
                            targetTab.id!,
                            {
                                type: "get_page_text",
                                inputHtml: frameHTML,
                                frameId: frames[i].frameId,
                            },
                            { frameId: frames[i].frameId },
                        );
                    }

                    if (downloadAsFile) {
                        await downloadStringAsFile(
                            targetTab,
                            frameHTML,
                            `tabHTML_${frames[i].frameId}.html`,
                        );

                        await downloadStringAsFile(
                            targetTab,
                            frameText,
                            `tabText_${frames[i].frameId}.txt`,
                        );
                    }

                    htmlFragments.push({
                        frameId: frames[i].frameId,
                        content: frameHTML,
                        text: frameText,
                    });
                }
            } catch (error) {
                console.error(
                    `Error getting HTML for frame ${frames[i].frameId}:`,
                    error,
                );
            }
        }
    }

    return htmlFragments;
}
