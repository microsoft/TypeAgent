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
 * Gets readable content from the page
 * @returns The readable content or an error
 */
export function getReadablePageContent(): PageContent {
    if (isProbablyReaderable(document)) {
        // readability updates the document object passed in - create a clone
        // to prevent modifying the live page
        var documentClone = document.cloneNode(true) as Document;
        var article = new Readability(documentClone).parse();

        // build usable text, with line breaks.
        if (article?.content) {
            let formattedText: string[] = [];
            var contentRoot = document.createElement("div");
            contentRoot.innerHTML = article?.content;

            formattedText = getTextInNode(contentRoot, formattedText);

            return {
                ...article,
                formattedText,
            };
        }
    }

    return { error: "Page content cannot be read" };
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
