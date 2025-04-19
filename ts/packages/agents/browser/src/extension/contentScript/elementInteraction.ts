// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ElementBoundingBoxes } from "./types";
import { getFullSelector, isVisible } from "./domUtils";

/**
 * Gets the bounding boxes of interactive elements on the page
 * @returns The bounding boxes
 */
export function getInteractiveElementsBoundingBoxes(): ElementBoundingBoxes {
    const allElements = Array.from(document.getElementsByTagName("*"));
    let textInputBounds: any[] = [];
    let clickBounds: any[] = [];
    let scrollBounds: any[] = [];
    let tableRowBounds: any[] = [];
    let tableColBounds: any[] = [];
    let tableCellBounds: any[] = [];
    let index = 0;
    let rowIndex = 0;
    let colIndex = 0;
    let isFirstRow = true;

    allElements.forEach((element: Element) => {
        if (element instanceof HTMLElement) {
            if (
                isVisible(element) &&
                !element.hidden &&
                element.checkVisibility({
                    checkVisibilityCSS: true,
                    checkOpacity: true,
                })
            ) {
                const bounds = element.getBoundingClientRect();
                if (element instanceof HTMLInputElement) {
                    if (element.tagName == "TEXT") {
                        textInputBounds.push({
                            top: bounds.top,
                            right: bounds.right,
                            bottom: bounds.bottom,
                            left: bounds.left,
                            selector: getFullSelector(element),
                            index: index,
                        });
                    } else {
                        clickBounds.push({
                            top: bounds.top,
                            right: bounds.right,
                            bottom: bounds.bottom,
                            left: bounds.left,
                            selector: getFullSelector(element),
                            index: index,
                        });
                    }

                    index += 1;
                } else if (
                    element instanceof HTMLAnchorElement ||
                    element instanceof HTMLButtonElement ||
                    element.getAttribute("onclick") != null
                ) {
                    clickBounds.push({
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        left: bounds.left,
                        selector: getFullSelector(element),
                        index: index,
                    });

                    index += 1;
                } else if (element instanceof HTMLTableRowElement) {
                    tableRowBounds.push({
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        left: bounds.left,
                        selector: getFullSelector(element),
                        index: rowIndex,
                    });
                    rowIndex += 1;
                    if (isFirstRow) {
                        // add all cells as columns
                        for (const col of element.children) {
                            const colBounds = col.getBoundingClientRect();
                            tableColBounds.push({
                                top: colBounds.top,
                                right: colBounds.right,
                                bottom: colBounds.bottom,
                                left: colBounds.left,
                                selector: getFullSelector(col as HTMLElement),
                                index: colIndex,
                            });
                            colIndex += 1;
                        }

                        isFirstRow = false;
                    }
                } else if (element instanceof HTMLTableColElement) {
                    tableColBounds.push({
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        left: bounds.left,
                        selector: getFullSelector(element),
                        index: colIndex,
                    });
                    colIndex += 1;
                } else if (element instanceof HTMLTableCellElement) {
                    tableCellBounds.push({
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        left: bounds.left,
                        selector: getFullSelector(element),
                        index: index,
                    });
                    index += 1;
                }

                // Uncomment if you want to enable scroll detection
                /*
                const scrollState = isScrollable(element);
                if (scrollState.vertical || scrollState.horizontal) {
                    scrollBounds.push({
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        left: bounds.left,
                        selector: getFullSelector(element),
                        index: index,
                    });
                }
                */

                if (element.getAttribute("handler_click")) {
                    console.log("Found handler added by patch");
                }
            }
        }
    });

    return {
        textInput: textInputBounds,
        click: clickBounds,
        scroll: scrollBounds,
        rows: tableRowBounds,
        cols: tableColBounds,
        cells: tableCellBounds,
    };
}

/**
 * Scrolls the page down
 */
export function scrollPageDown(): void {
    window.scrollTo(0, window.scrollY + window.innerHeight * 0.9);
}

/**
 * Scrolls the page up
 */
export function scrollPageUp(): void {
    window.scrollTo(0, window.scrollY - window.innerHeight * 0.9);
}

/**
 * Sends a request to the UI events dispatcher
 * @param message The message to send
 * @returns Promise resolving to the response
 */
export async function sendUIEventsRequest(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const requestId = `request_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const listener = (event: MessageEvent) => {
            if (event.source !== window) return;

            const data = event.data;
            if (
                data &&
                data.type === "main-world-response" &&
                data.requestId === requestId
            ) {
                window.removeEventListener("message", listener);

                if (data.error) {
                    reject(new Error(data.error));
                } else {
                    resolve(data.result);
                }
            }
        };

        window.addEventListener("message", listener);

        // Send the message with the request ID
        window.postMessage(
            {
                type: "content-script-request",
                requestId: requestId,
                payload: message,
            },
            "*",
        );

        // Add a timeout to prevent hanging promises
        setTimeout(() => {
            window.removeEventListener("message", listener);
            reject(new Error("Request to main world timed out"));
        }, 10000);
    });
}

/**
 * Sends a request to the PaleoDB automation
 * @param data The data to send
 */
export function sendPaleoDbRequest(data: any): void {
    document.dispatchEvent(
        new CustomEvent("toPaleoDbAutomation", { detail: data }),
    );
}
