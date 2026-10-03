// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { toMarkdown } from "../../src/converters/pdfToMarkdown/export.js";

const document = JSON.parse(
    await readFile(
        new URL("./markdown-document.json", import.meta.url),
        "utf8",
    ),
);
const golden = JSON.parse(
    await readFile(new URL("./markdown-parity.json", import.meta.url), "utf8"),
);
for (const entry of golden.cases) {
    test(`exact upstream Markdown parity ${JSON.stringify(entry.options)}`, () => {
        const markdown = toMarkdown(document, entry.options);
        assert.equal(markdown, entry.markdown);
        assert.ok(!markdown.includes("Discard recurring"));
        assert.match(markdown, /\\frac\{a\}\{b\} \+ \\sqrt\{x\}/);
        if (!entry.options.pageBreaks)
            assert.ok(!markdown.includes("<!-- página"));
    });
}
