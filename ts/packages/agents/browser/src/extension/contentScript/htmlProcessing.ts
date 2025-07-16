// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { HTMLReducer } from "./htmlReducer";
import DOMPurify from "dompurify";
import { setIdsOnAllElements, markInvisibleNodesForCleanup } from "./domUtils";
import { HtmlFragment } from "./types";
import { Readability, isProbablyReaderable } from "@mozilla/readability";

/**
 * Gets the HTML of the page
 * @param fullSize Whether to get the full HTML
 * @param documentHtml The HTML to process
 * @param frameId The frame ID
 * @param useTimestampIds Whether to use timestamp IDs
 * @param filterToReadingView Whether to apply readability filter
 * @param keepMetaTags Whether to preserve meta tags when using readability
 * @returns The processed HTML
 */
export function getPageHTML(
    fullSize?: boolean,
    documentHtml?: string,
    frameId?: number,
    useTimestampIds?: boolean,
    filterToReadingView?: boolean,
    keepMetaTags?: boolean,
): string {
    if (!documentHtml) {
        if (frameId !== undefined) {
            setIdsOnAllElements(frameId, useTimestampIds);
        }
        markInvisibleNodesForCleanup();
        documentHtml = document.children[0].outerHTML;
    }

    // Apply Readability filter if requested
    if (filterToReadingView) {
        documentHtml = applyReadabilityFilter(documentHtml, keepMetaTags);
    }

    if (fullSize) {
        return documentHtml;
    }

    const reducer = new HTMLReducer();
    reducer.removeDivs = false;
    
    // Preserve meta tags if requested and readability was used
    if (filterToReadingView && keepMetaTags) {
        reducer.removeMetaTags = false;
    }
    
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

/**
 * Apply Readability filter to extract main content
 * @param html The HTML to process
 * @param keepMetaTags Whether to preserve meta tags
 * @returns The processed HTML with main content extracted
 */
function applyReadabilityFilter(html: string, keepMetaTags?: boolean): string {
    try {
        // Parse the HTML
        const domParser = new DOMParser();
        const doc = domParser.parseFromString(html, "text/html");
        
        // Check if readability can process this document
        if (!isProbablyReaderable(doc)) {
            console.warn("Document is not probably readerable, skipping Readability filter");
            return html;
        }
        
        // Clone document to avoid modifying original
        const documentClone = doc.cloneNode(true) as Document;
        
        // Extract meta tags before applying Readability if we want to preserve them
        let metaTags = '';
        if (keepMetaTags) {
            const headClone = documentClone.head?.cloneNode(true) as HTMLHeadElement;
            if (headClone) {
                const metaElements = headClone.querySelectorAll('meta, title');
                metaTags = Array.from(metaElements).map(el => el.outerHTML).join('\n');
            }
        }
        
        // Apply Readability
        const article = new Readability(documentClone).parse();
        
        if (article?.content) {
            // Construct new HTML with main content
            let resultHtml = `<html><head>${metaTags}</head><body>${article.content}</body></html>`;
            return resultHtml;
        } else {
            console.warn("Readability failed to extract content, falling back to original HTML");
            return html;
        }
        
    } catch (error) {
        console.error("Error applying Readability filter:", error);
        return html; // Fallback to original HTML
    }
}
