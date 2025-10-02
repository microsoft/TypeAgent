// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CrossContextHtmlReducer } from "../../common/crossContextHtmlReducer";
import DOMPurify from "dompurify";
import { setIdsOnAllElements, markInvisibleNodesForCleanup } from "./domUtils";
import { HtmlFragment } from "./types";
import { Readability, isProbablyReaderable } from "@mozilla/readability";

export enum CompressionMode {
    None = "None",
    Automation = "automation",
    KnowledgeExtraction = "knowledgeExtraction",
}

/**
 * Gets the HTML of the page using the new consolidated HTML processing system
 * @param compressionMode The compression mode to use (defaults to automation)
 * @param documentHtml The HTML to process
 * @param frameId The frame ID
 * @param useTimestampIds Whether to use timestamp IDs
 * @param filterToReadingView Whether to apply readability filter
 * @param keepMetaTags Whether to preserve meta tags when using readability
 * @returns The processed HTML
 */
export function getPageHTML(
    compressionMode: CompressionMode = CompressionMode.Automation,
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

    if (compressionMode === CompressionMode.None) {
        return documentHtml;
    }

    const reducer = new CrossContextHtmlReducer();
    reducer.removeDivs = false;

    // Apply more aggressive filtering for knowledge extraction
    if (compressionMode === CompressionMode.KnowledgeExtraction) {
        reducer.removeMiscTags = true;
        reducer.removeAllClasses = true;
    }

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
 * @param compressionMode The compression mode to use (defaults to automation)
 * @returns Array of HTML fragments
 */
export function getPageHTMLFragments(
    fragmentSelectors: string[],
    frameId: number,
    useTimestampIds?: boolean,
    filterToReadingView?: boolean,
    keepMetaTags?: boolean,
    compressionMode: CompressionMode = CompressionMode.Automation,
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
                if (compressionMode === CompressionMode.None) {
                    fragments.push({
                        frameId: frameId,
                        content: element.outerHTML,
                    });
                    return;
                }

                const reducer = new CrossContextHtmlReducer();
                reducer.removeDivs = false;

                // Apply more aggressive filtering for knowledge extraction
                if (compressionMode === CompressionMode.KnowledgeExtraction) {
                    reducer.removeMiscTags = true;
                    reducer.removeAllClasses = true;
                }

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
