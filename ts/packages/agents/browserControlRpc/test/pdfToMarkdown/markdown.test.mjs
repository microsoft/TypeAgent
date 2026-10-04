// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    blockMarkdown,
    toMarkdown,
} from "../../src/converters/pdfToMarkdown/export.js";
import { mathSpans } from "../../src/converters/pdfToMarkdown/mathtext.js";

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

test("inline formatting preserves long outer whitespace runs", () => {
    const whitespace = "\t".repeat(100_000);
    assert.equal(
        blockMarkdown({
            type: "list_item",
            runs: [{ text: `${whitespace}word${whitespace}`, bold: true }],
        }),
        `- ${whitespace}**word**${whitespace}`,
    );
});

test("LaTeX inline text escapes backslashes before Markdown metacharacters", () => {
    assert.equal(
        blockMarkdown(
            { type: "paragraph", runs: [{ text: String.raw`path\*cost$` }] },
            "ref",
            "latex",
        ),
        String.raw`path\\\*cost\$`,
    );
});

test("math span parsing strips long trailing punctuation runs", () => {
    const punctuation = "!".repeat(100_000);
    assert.deepEqual(mathSpans(`x = 1${punctuation}`), [[0, 5]]);
});
