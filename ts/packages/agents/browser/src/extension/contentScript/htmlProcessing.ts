// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { HTMLReducer } from "./htmlReducer";
import DOMPurify from "dompurify";
import { setIdsOnAllElements, markInvisibleNodesForCleanup } from "./domUtils";
import { HtmlFragment } from "./types";

/**
 * Gets the HTML of the page
 * @param fullSize Whether to get the full HTML
 * @param documentHtml The HTML to process
 * @param frameId The frame ID
 * @param useTimestampIds Whether to use timestamp IDs
 * @returns The processed HTML
 */
export function getPageHTML(
    fullSize?: boolean,
    documentHtml?: string,
    frameId?: number,
    useTimestampIds?: boolean,
): string {
    if (!documentHtml) {
        if (frameId !== undefined) {
            setIdsOnAllElements(frameId, useTimestampIds);
        }
        markInvisibleNodesForCleanup();
        documentHtml = document.children[0].outerHTML;
    }

    if (fullSize) {
        return documentHtml;
    }

    const reducer = new HTMLReducer();
    reducer.removeDivs = false;
    const reducedHtml = reducer.reduce(documentHtml);
    return reducedHtml;
}

/**
 * Gets HTML fragments matching CSS selectors
 * @param documentHtml The HTML to process
 * @param cssSelectors The CSS selectors to match
 * @param frameId The frame ID
 * @returns The HTML fragments
 */
export function getPageHTMLSubFragments(
    documentHtml: string,
    cssSelectors: string,
    frameId: number,
): HtmlFragment[] {
    const domParser = new DOMParser();
    const doc = domParser.parseFromString(
        DOMPurify.sanitize(documentHtml),
        "text/html",
    );
    const elements = doc.documentElement.querySelectorAll(cssSelectors);
    let htmlFragments: HtmlFragment[] = [];

    if (elements) {
        for (let i = 0; i < elements.length; i++) {
            htmlFragments.push({
                frameId: frameId,
                content: elements[i].outerHTML,
            });
        }
    }

    return htmlFragments;
}

/**
 * Gets HTML fragments within size limits
 * @param documentHtml The HTML to process
 * @param frameId The frame ID
 * @param useTimestampIds Whether to use timestamp IDs
 * @param maxSize The maximum size of a fragment
 * @returns The HTML fragments
 */
export function getPageHTMLFragments(
    documentHtml: string,
    frameId: number,
    useTimestampIds: boolean,
    maxSize: number = 16000,
): HtmlFragment[] {
    if (!documentHtml) {
        documentHtml = getPageHTML(
            false,
            documentHtml,
            frameId,
            useTimestampIds,
        );
    }

    const domParser = new DOMParser();
    const doc = domParser.parseFromString(
        DOMPurify.sanitize(documentHtml),
        "text/html",
    );

    let htmlFragments: HtmlFragment[] = [];
    let node = doc.body;

    while (node) {
        if (node.outerHTML.length > maxSize) {
            if (node.children.length > 0) {
                let largestIndex = 0;
                let largestSize = 0;

                for (let i = 0; i < node.children.length; i++) {
                    if (node.children[i].outerHTML.length > largestSize) {
                        largestIndex = i;
                        largestSize = node.children[i].outerHTML.length;
                    }
                }

                node = node.children[largestIndex] as HTMLElement;
            } else {
                break;
            }
        } else {
            htmlFragments.push({
                frameId: frameId,
                content: node.outerHTML,
            });

            node.remove();

            if (node == doc.body) {
                break;
            } else {
                node = doc.body;
            }
        }
    }

    return htmlFragments;
}
