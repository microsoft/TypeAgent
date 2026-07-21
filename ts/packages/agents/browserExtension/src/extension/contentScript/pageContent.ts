// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { convert } from "html-to-text";
import { PageContent } from "./types";

/**
 * Gets text nodes from a DOM node
 * @param currentNode The node to extract text from
 * @param sentences The array to add sentences to
 * @returns The array of sentences
 */
export function getTextInNode(
    currentNode: Node,
    sentences: string[],
): string[] {
    if (currentNode.nodeType == Node.TEXT_NODE && currentNode.textContent) {
        sentences.push(currentNode.textContent);
    }

    if (currentNode.hasChildNodes()) {
        currentNode.childNodes.forEach((node) => {
            sentences = getTextInNode(node, sentences);
        });
    }

    return sentences;
}

/**
 * Thresholds for deciding whether a Readability extraction is "substantial"
 * or likely just boilerplate (e.g. "Loading…") from a JS-dependent page.
 */
const MIN_CONTENT_LENGTH = 200;
const MIN_CONTENT_RATIO = 0.001;

/**
 * Strips hidden attributes from elements so Readability can see hidden content.
 * Useful for React streaming SSR pages that hide content initially.
 */
function stripHiddenAttributes(doc: Document): void {
    const hiddenElements = doc.querySelectorAll("[hidden]");
    for (let i = 0; i < hiddenElements.length; i++) {
        hiddenElements[i].removeAttribute("hidden");
    }
}

/**
 * Checks if the extracted content is substantial enough to be useful.
 */
function isContentSubstantial(
    content: string,
    originalHtmlLength: number,
): boolean {
    if (content.length < MIN_CONTENT_LENGTH) {
        return false;
    }
    if (
        originalHtmlLength > 0 &&
        content.length / originalHtmlLength < MIN_CONTENT_RATIO
    ) {
        return false;
    }
    return true;
}

/**
 * Tries to extract content using Readability.
 * Returns the article and formatted text if successful, null otherwise.
 */
function tryReadabilityExtraction(doc: Document): PageContent | null {
    if (!isProbablyReaderable(doc)) {
        return null;
    }

    const documentClone = doc.cloneNode(true) as Document;
    const article = new Readability(documentClone).parse();

    if (article?.content) {
        const formattedText: string[] = [];
        const contentRoot = document.createElement("div");
        contentRoot.innerHTML = article.content;
        getTextInNode(contentRoot, formattedText);

        return {
            ...article,
            formattedText,
        };
    }

    return null;
}

/**
 * Fallback extraction using html-to-text for non-article pages (forms, web apps).
 */
function fallbackTextExtraction(): PageContent {
    const html = document.documentElement.outerHTML;
    const text = convert(html, {
        wordwrap: 130,
        selectors: [
            { selector: "script", format: "skip" },
            { selector: "style", format: "skip" },
            { selector: "noscript", format: "skip" },
            { selector: "img", format: "skip" },
            { selector: "a", options: { ignoreHref: true } },
        ],
    });

    const formattedText = text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    return {
        title: document.title,
        content: text,
        textContent: text,
        formattedText,
        length: text.length,
    };
}

/**
 * Gets readable content from the page with fallback for non-article pages.
 * @returns The readable content
 */
export function getReadablePageContent(): PageContent {
    const htmlLength = document.documentElement.outerHTML.length;

    // Step 1: Try normal Readability extraction
    const readabilityResult = tryReadabilityExtraction(document);

    if (readabilityResult) {
        const contentText = readabilityResult.formattedText?.join(" ") || "";
        if (isContentSubstantial(contentText, htmlLength)) {
            return readabilityResult;
        }
    }

    // Step 2: Try with hidden attributes stripped (for React SSR pages)
    const documentClone = document.cloneNode(true) as Document;
    stripHiddenAttributes(documentClone);
    const unhiddenResult = tryReadabilityExtraction(documentClone);

    if (unhiddenResult) {
        const unhiddenText = unhiddenResult.formattedText?.join(" ") || "";
        const readabilityText =
            readabilityResult?.formattedText?.join(" ") || "";

        // Use whichever extraction yielded more content
        if (
            unhiddenText.length > readabilityText.length &&
            isContentSubstantial(unhiddenText, htmlLength)
        ) {
            return unhiddenResult;
        }
    }

    // Step 3: If we have any Readability result (even thin), check if it's better than nothing
    if (
        readabilityResult &&
        (readabilityResult.formattedText?.join(" ").length || 0) > 50
    ) {
        return readabilityResult;
    }

    // Step 4: Fallback to html-to-text for non-article pages (forms, web apps)
    return fallbackTextExtraction();
}

/**
 * Gets text from HTML
 * @param documentHtml The HTML to extract text from
 * @param frameId The frame ID
 * @returns The extracted text
 */
export function getPageText(documentHtml: string, frameId: number): string {
    const options = {
        wordwrap: 130,
    };

    const text = convert(documentHtml, options);
    return text;
}
