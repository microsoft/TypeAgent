// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { BrowserCaptureSnapshot } from "@typeagent/browser-control-rpc/types";

/** No awaits: metadata and HTML must come from a single document turn. */
export function captureDocumentSnapshot(
    document: Document,
    expectedUrl: string,
): Omit<BrowserCaptureSnapshot, "pageId"> {
    const url = document.URL;
    if (url !== expectedUrl || !/^https?:\/\//i.test(url)) {
        throw new Error("The selected page navigated. Refresh the page list.");
    }
    return {
        url,
        title: document.title,
        htmlFragments: [
            { frameId: "0", content: document.documentElement.outerHTML },
        ],
        warnings: document.querySelector("iframe,frame,object,embed")
            ? [
                  "Embedded frames are omitted; only the root document was captured.",
              ]
            : [],
    };
}
