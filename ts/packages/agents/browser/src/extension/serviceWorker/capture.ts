// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BoundingBox, HTMLFragment } from "./types";
import { downloadStringAsFile } from "./tabManager";

export enum CompressionMode {
    None = "None",
    Automation = "automation",
    KnowledgeExtraction = "knowledgeExtraction",
}

/**
 * Gets HTML fragments from a tab
 * @param targetTab The tab to get fragments from
 * @param compressionModeOrFullSize Either CompressionMode enum or legacy boolean fullSize
 * @param downloadAsFile Whether to download the HTML as a file
 * @param extractText Whether to extract text from the HTML
 * @param useTimestampIds Whether to use timestamp IDs
 * @param filterToReadingView Whether to apply readability filter
 * @param keepMetaTags Whether to preserve meta tags when using readability
 * @returns Promise resolving to an array of HTML fragments
 */
export async function getTabHTMLFragments(
    targetTab: chrome.tabs.Tab,
    compressionModeOrFullSize?: CompressionMode | boolean,
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
                // Convert legacy boolean or new CompressionMode to boolean for backward compatibility
                const fullSize =
                    typeof compressionModeOrFullSize === "boolean"
                        ? compressionModeOrFullSize
                        : compressionModeOrFullSize === CompressionMode.None;

                // For knowledge extraction, disable text extraction since textpro will handle HTML-to-markdown conversion
                const shouldExtractText =
                    extractText &&
                    (typeof compressionModeOrFullSize !== "object" ||
                        compressionModeOrFullSize !==
                            CompressionMode.KnowledgeExtraction);

                const frameHTML = await chrome.tabs.sendMessage(
                    targetTab.id!,
                    {
                        type: "get_reduced_html",
                        compressionMode:
                            typeof compressionModeOrFullSize === "object"
                                ? compressionModeOrFullSize
                                : undefined,
                        fullSize: fullSize, // Keep for backward compatibility
                        frameId: frames[i].frameId,
                        useTimestampIds: useTimestampIds,
                        filterToReadingView: filterToReadingView,
                        keepMetaTags: keepMetaTags,
                    },
                    { frameId: frames[i].frameId },
                );

                if (frameHTML) {
                    let frameText = "";
                    if (shouldExtractText) {
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
