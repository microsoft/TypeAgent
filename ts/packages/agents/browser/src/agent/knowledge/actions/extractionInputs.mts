// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { convert } from "html-to-text";

export interface BrowserDocumentExtractionInput {
    url: string;
    title: string;
    htmlFragments: unknown[];
    textContent: string;
    source: "direct" | "index" | "bookmark" | "history" | "import";
    timestamp?: string;
    metadata: { frameId?: number; isIframe: boolean };
}

export function createExtractionInputsFromFragments(
    htmlFragments: Array<{ frameId?: number; content?: string; text?: string }>,
    url: string,
    title: string,
    source: BrowserDocumentExtractionInput["source"],
    timestamp?: string,
): BrowserDocumentExtractionInput[] {
    return htmlFragments
        .map((fragment, index) => {
            const frameId = fragment.frameId ?? index;
            const textContent =
                typeof fragment.content === "string" &&
                fragment.content.trim().length > 0
                    ? convert(fragment.content, {
                          wordwrap: false,
                          selectors: [
                              { selector: "script", format: "skip" },
                              { selector: "style", format: "skip" },
                          ],
                      }).trim()
                    : typeof fragment.text === "string"
                      ? fragment.text.trim()
                      : "";
            const input: BrowserDocumentExtractionInput = {
                url: `${url}#iframe-${frameId}`,
                title: `${title} (Frame ${frameId})`,
                htmlFragments: [fragment],
                textContent,
                source,
                metadata: { frameId, isIframe: frameId !== 0 },
            };
            if (timestamp !== undefined) input.timestamp = timestamp;
            return input;
        })
        .filter((input) => input.textContent.length > 50);
}
