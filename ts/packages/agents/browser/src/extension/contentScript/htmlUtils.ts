// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CrossContextHtmlReducer } from "../../common/crossContextHtmlReducer";
import DOMPurify from "dompurify";
import { setIdsOnAllElements, markInvisibleNodesForCleanup } from "./domUtils";
import { HtmlFragment } from "./types";
import { Readability, isProbablyReaderable } from "@mozilla/readability";

/**
 * Gets the HTML of the page using the new consolidated HTML processing system
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

    const reducer = new CrossContextHtmlReducer();
    reducer.removeDivs = false;

    // Preserve meta tags if requested and readability was used
    if (filterToReadingView && keepMetaTags) {
        reducer.removeMetaTags = false;
    }

    return reducer.reduce(documentHtml);
}

/**
 * Gets HTML fragments from the page using the new consolidated system
 * @param fragmentSelectors CSS selectors for fragments
 * @param frameId The frame ID
 * @param useTimestampIds Whether to use timestamp IDs
 * @param filterToReadingView Whether to apply readability filter
 * @param keepMetaTags Whether to preserve meta tags when using readability
 * @returns Array of HTML fragments
 */
export function getPageHTMLFragments(
    fragmentSelectors: string[],
    frameId: number,
    useTimestampIds?: boolean,
    filterToReadingView?: boolean,
    keepMetaTags?: boolean,
): HtmlFragment[] {
    if (frameId !== undefined) {
        setIdsOnAllElements(frameId, useTimestampIds);
    }
    markInvisibleNodesForCleanup();

    let documentHtml = document.children[0].outerHTML;

    // Apply Readability filter if requested
    if (filterToReadingView) {
        documentHtml = applyReadabilityFilter(documentHtml, keepMetaTags);
    }

    const fragments: HtmlFragment[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(documentHtml, "text/html");

    for (const selector of fragmentSelectors) {
        const elements = doc.querySelectorAll(selector);
        elements.forEach((element) => {
            if (element instanceof HTMLElement) {
                const reducer = new CrossContextHtmlReducer();
                reducer.removeDivs = false;

                if (filterToReadingView && keepMetaTags) {
                    reducer.removeMetaTags = false;
                }

                fragments.push({
                    frameId: frameId,
                    content: reducer.reduce(element.outerHTML),
                });
            }
        });
    }

    return fragments;
}

/**
 * Gets HTML sub-fragments from the page using the new consolidated system
 * @param mainSelector Main CSS selector
 * @param subSelectors Sub-selectors within the main selector
 * @param frameId The frame ID
 * @param useTimestampIds Whether to use timestamp IDs
 * @param filterToReadingView Whether to apply readability filter
 * @param keepMetaTags Whether to preserve meta tags when using readability
 * @returns Array of HTML fragments
 */
export function getPageHTMLSubFragments(
    mainSelector: string,
    subSelectors: string[],
    frameId: number,
    useTimestampIds?: boolean,
    filterToReadingView?: boolean,
    keepMetaTags?: boolean,
): HtmlFragment[] {
    if (frameId !== undefined) {
        setIdsOnAllElements(frameId, useTimestampIds);
    }
    markInvisibleNodesForCleanup();

    let documentHtml = document.children[0].outerHTML;

    // Apply Readability filter if requested
    if (filterToReadingView) {
        documentHtml = applyReadabilityFilter(documentHtml, keepMetaTags);
    }

    const fragments: HtmlFragment[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(documentHtml, "text/html");

    const mainElements = doc.querySelectorAll(mainSelector);
    mainElements.forEach((mainElement) => {
        if (mainElement instanceof HTMLElement) {
            for (const subSelector of subSelectors) {
                const subElements = mainElement.querySelectorAll(subSelector);
                subElements.forEach((subElement) => {
                    if (subElement instanceof HTMLElement) {
                        const reducer = new CrossContextHtmlReducer();
                        reducer.removeDivs = false;

                        if (filterToReadingView && keepMetaTags) {
                            reducer.removeMetaTags = false;
                        }

                        fragments.push({
                            frameId: frameId,
                            content: reducer.reduce(subElement.outerHTML),
                        });
                    }
                });
            }
        }
    });

    return fragments;
}

/**
 * Apply readability filter to HTML content
 * @param html HTML content to filter
 * @param keepMetaTags Whether to preserve meta tags
 * @returns Filtered HTML
 */
function applyReadabilityFilter(html: string, keepMetaTags?: boolean): string {
    try {
        const sanitizedHtml = DOMPurify.sanitize(html);
        const parser = new DOMParser();
        const doc = parser.parseFromString(sanitizedHtml, "text/html");

        if (!isProbablyReaderable(doc)) {
            console.warn(
                "Document may not be suitable for readability extraction",
            );
        }

        const reader = new Readability(doc, {
            keepClasses: false,
            disableJSONLD: true,
        });

        const article = reader.parse();
        if (!article || !article.content) {
            console.warn(
                "Readability failed to parse content, returning original",
            );
            return html;
        }

        if (keepMetaTags) {
            // Extract meta tags from original HTML
            const originalDoc = parser.parseFromString(
                sanitizedHtml,
                "text/html",
            );
            const metaTags = originalDoc.querySelectorAll("meta");

            // Parse the article content
            const articleDoc = parser.parseFromString(
                article.content,
                "text/html",
            );
            const head =
                articleDoc.querySelector("head") ||
                articleDoc.createElement("head");

            // Add meta tags to the article
            metaTags.forEach((meta) => {
                if (meta instanceof HTMLMetaElement) {
                    head.appendChild(meta.cloneNode(true));
                }
            });

            if (!articleDoc.querySelector("head")) {
                articleDoc.documentElement.insertBefore(head, articleDoc.body);
            }

            return articleDoc.documentElement.outerHTML;
        }

        return article.content;
    } catch (error) {
        console.error("Error applying readability filter:", error);
        return html;
    }
}
