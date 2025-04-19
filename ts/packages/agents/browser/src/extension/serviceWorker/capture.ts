// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BoundingBox, HTMLFragment } from "./types";
import {
    getActiveTab,
    downloadImageAsFile,
    downloadStringAsFile,
} from "./tabManager";

/**
 * Gets HTML fragments from a tab
 * @param targetTab The tab to get fragments from
 * @param fullSize Whether to get the full HTML
 * @param downloadAsFile Whether to download the HTML as a file
 * @param extractText Whether to extract text from the HTML
 * @param useTimestampIds Whether to use timestamp IDs
 * @returns Promise resolving to an array of HTML fragments
 */
export async function getTabHTMLFragments(
    targetTab: chrome.tabs.Tab,
    fullSize?: boolean,
    downloadAsFile?: boolean,
    extractText?: boolean,
    useTimestampIds?: boolean,
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

/**
 * Gets filtered HTML fragments from a tab
 * @param targetTab The tab to get fragments from
 * @param inputHtmlFragments The input HTML fragments to filter
 * @param cssSelectorsToKeep The CSS selectors to keep
 * @returns Promise resolving to an array of filtered HTML fragments
 */
export async function getFilteredHTMLFragments(
    targetTab: chrome.tabs.Tab,
    inputHtmlFragments: HTMLFragment[],
    cssSelectorsToKeep: string[],
): Promise<any[]> {
    let htmlFragments: any[] = [];

    for (let i = 0; i < inputHtmlFragments.length; i++) {
        try {
            const frameHTMLFragments = await chrome.tabs.sendMessage(
                targetTab.id!,
                {
                    type: "get_filtered_html_fragments",
                    inputHtml: inputHtmlFragments[i].content,
                    cssSelectors: cssSelectorsToKeep.join(", "),
                    frameId: inputHtmlFragments[i].frameId,
                },
                { frameId: inputHtmlFragments[i].frameId },
            );

            if (frameHTMLFragments) {
                htmlFragments.push(...frameHTMLFragments);
            }
        } catch (error) {
            console.error(
                `Error filtering HTML for frame ${inputHtmlFragments[i].frameId}:`,
                error,
            );
        }
    }

    return htmlFragments;
}

/**
 * Captures a screenshot of the current tab
 * @param downloadImage Whether to download the image
 * @returns Promise resolving to the data URL of the screenshot
 */
export async function getTabScreenshot(
    downloadImage: boolean,
): Promise<string> {
    const targetTab = await getActiveTab();
    const dataUrl = await chrome.tabs.captureVisibleTab({ quality: 100 });
    if (downloadImage && targetTab) {
        await downloadImageAsFile(targetTab, dataUrl, "test.jpg");
    }

    return dataUrl;
}

/**
 * Captures an annotated screenshot of the current tab with element bounding boxes
 * @param downloadImage Whether to download the image
 * @returns Promise resolving to the data URL of the annotated screenshot
 */
export async function getTabAnnotatedScreenshot(
    downloadImage: boolean,
): Promise<string> {
    const targetTab = await getActiveTab();
    if (!targetTab || !targetTab.id) {
        return "";
    }

    const boundingBoxes = await chrome.tabs.sendMessage(targetTab.id, {
        type: "get_element_bounding_boxes",
    });

    const dataUrl = await chrome.tabs.captureVisibleTab(targetTab.windowId!, {
        quality: 100,
    });
    if (downloadImage) {
        await downloadImageAsFile(targetTab, dataUrl, "tabScreenshot.jpg");
    }

    const annotate = async (dataUrl: string, boundingBoxes: any) => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        const loadImage = (url: string) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.addEventListener("load", () => resolve(img));
                img.addEventListener("error", (err) => reject(err));
                img.src = url;
            });

        const img = await loadImage(dataUrl);
        // pad image with 5 px all around
        canvas.width = img.width + 10;
        canvas.height = img.height + 10;

        console.log(
            "Device pixel ratio: " + window.devicePixelRatio.toString(),
        );
        ctx?.drawImage(img, 5, 5, img.width, img.height);

        ctx?.scale(window.devicePixelRatio, window.devicePixelRatio);

        if (boundingBoxes && ctx) {
            const drawBoundingBox = (
                box: BoundingBox,
                color: string,
                padding: number,
                labelPosition:
                    | "topLeftOut"
                    | "bottomRightIn"
                    | "above"
                    | "rightOut"
                    | "middle"
                    | "none",
            ) => {
                ctx.lineWidth = 0;
                ctx.beginPath();
                ctx.rect(
                    box.left,
                    box.top,
                    box.right - box.left,
                    box.bottom - box.top,
                );
                ctx.strokeStyle = color;
                ctx.stroke();

                // draw number marker
                ctx.font = "16px Arial";
                ctx.textBaseline = "top";

                const text = box.index!.toString();
                var width = ctx.measureText(text).width;
                var height = 16;

                ctx.fillStyle = color;

                if (labelPosition !== "none") {
                    let textLeft = box.left;
                    let textTop = box.top;

                    switch (labelPosition) {
                        case "bottomRightIn": {
                            textLeft = box.right - width - padding;
                            textTop = box.bottom - height - padding / 2;
                            break;
                        }
                        case "middle": {
                            textLeft =
                                box.left + (box.right - box.left - width) / 2;
                            textTop =
                                box.top + (box.bottom - box.top - height) / 2;
                            break;
                        }
                        case "above": {
                            textLeft =
                                box.left + (box.right - box.left - width) / 2;
                            textTop = box.top - height;
                            break;
                        }
                        case "rightOut": {
                            textLeft = box.right + 4;
                            textTop =
                                box.top + (box.bottom - box.top - height) / 2;
                            break;
                        }
                    }

                    ctx.fillRect(
                        textLeft + padding - 2,
                        textTop + padding - 4,
                        width + 4,
                        height + 4,
                    );

                    ctx.fillStyle = "white";
                    ctx.fillText(text, textLeft + padding, textTop + padding);
                }
                ctx.restore();
            };

            console.log("Found bounding boxes");
            const labelPosition = "topLeftOut";
            boundingBoxes.textInput.forEach((box: BoundingBox) => {
                drawBoundingBox(box, "red", 5, labelPosition);
            });

            boundingBoxes.click.forEach((box: BoundingBox) => {
                drawBoundingBox(box, "blue", 5, labelPosition);
            });

            boundingBoxes.scroll.forEach((box: BoundingBox) => {
                drawBoundingBox(box, "green", 5, labelPosition);
            });

            boundingBoxes.rows.forEach((box: BoundingBox) => {
                drawBoundingBox(box, "green", 5, "rightOut");
            });

            boundingBoxes.cols.forEach((box: BoundingBox) => {
                drawBoundingBox(box, "green", 5, "above");
            });

            boundingBoxes.cells.forEach((box: BoundingBox) => {
                drawBoundingBox(box, "green", 5, "none");
            });
        } else {
            console.log("Did not Find bounding boxes");
        }

        // get image from canvas
        return canvas.toDataURL();
    };

    const annotationResults = await chrome.scripting.executeScript({
        func: annotate,
        target: { tabId: targetTab.id! },
        args: [dataUrl, boundingBoxes],
    });

    if (annotationResults) {
        const annotatedScreen = annotationResults[0];
        if (downloadImage) {
            await downloadImageAsFile(
                targetTab,
                annotatedScreen.result,
                "testAnnotated.jpg",
            );
        }

        return annotatedScreen.result;
    }

    return dataUrl;
}
