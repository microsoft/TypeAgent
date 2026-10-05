// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";

test("built Markdown serialization does not load the browser-only PDF.js engine", async () => {
    assert.equal(globalThis.DOMMatrix, undefined);
    const { renderPdfSemanticDocument } = await import(
        "../../dist/pdfMarkdown.js"
    );
    assert.equal(
        renderPdfSemanticDocument({
            pages: [
                {
                    number: 1,
                    blocks: [{ type: "paragraph", text: "Server capture" }],
                },
            ],
        }),
        "Server capture\n",
    );
    assert.equal(globalThis.DOMMatrix, undefined);
});
