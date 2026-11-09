// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fixturePdf } from "./pdfToMarkdown/fixture.mjs";
const require = createRequire(new URL("../package.json", import.meta.url));
const { DOMMatrix, ImageData, Path2D } = require("@napi-rs/canvas");
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const { extractPdfMarkdown, serializePdfArtifact, preparePdfCapture } =
    await import("../dist/pdfMarkdown.js");
const { openPdf } = await import("../dist/converters/pdfToMarkdown/engine.js");
const { toMarkdown } = await import(
    "../dist/converters/pdfToMarkdown/index.js"
);

function artifact() {
    return {
        schemaVersion: 1,
        extractorVersion: "legacy/1",
        pdfjsVersion: "5.3.31",
        byteHash: "a".repeat(64),
        pageCount: 1,
        pages: [
            { page: 1, width: 600, height: 800, rotation: 0, warnings: [] },
        ],
        blocks: [
            {
                id: "p1-b0",
                page: 1,
                kind: "paragraph",
                order: 0,
                bbox: [0, 0, 10, 10],
                text: "Legacy text",
            },
        ],
        warnings: [],
        coverage: [1],
    };
}
test("production emitted engine extracts real operator glyphs without owning viewer proxy", async () => {
    const pdf = await openPdf(fixturePdf(), {
        getDocumentOptions: { useSystemFonts: true, disableFontFace: true },
    });
    const progress = [];
    try {
        const result = await extractPdfMarkdown(
            pdf,
            (done, total) => progress.push([done, total]),
            { byteHash: "b".repeat(64), pdfjsVersion: "5.3.31" },
        );
        assert.deepEqual(progress, [[1, 1]]);
        assert.ok(result.artifact.semanticDocument);
        assert.ok(
            result.artifact.blocks.some((block) => block.kind === "table"),
        );
        assert.match(
            result.markdown,
            /Operator glyph text with local PDF\.js\./,
        );
        assert.doesNotMatch(result.markdown, /## Page|^---/);
        const retained = JSON.parse(serializePdfArtifact(result.artifact));
        assert.equal(
            (await preparePdfCapture(retained)).markdown,
            result.markdown,
        );
        assert.equal(
            result.markdown,
            toMarkdown(retained.semanticDocument, {
                math: "latex",
                images: "none",
                pageBreaks: false,
            }),
        );
        assert.ok(
            (await (await pdf.getPage(1)).getOperatorList()).fnArray.length,
        );
    } finally {
        await pdf.destroy();
    }
});
test("canonical semantic serialization preserves headings, math, tables and runs but strips transient metadata", async () => {
    const value = artifact();
    value.semanticDocument = {
        elapsed_ms: 10,
        timings: { total_ms: 12 },
        pages: [
            {
                number: 1,
                blocks: [
                    { type: "heading", text: "Semantic title", level: 1 },
                    {
                        type: "formula",
                        text: "x2",
                        latex: "x^{2}",
                        number: "(1)",
                    },
                    {
                        type: "table",
                        text: "",
                        rows: [
                            ["Name", "Value"],
                            ["x", "2"],
                        ],
                    },
                    {
                        type: "paragraph",
                        text: "bold",
                        runs: [{ text: "bold", bold: true }],
                    },
                ],
            },
        ],
    };
    const encoded = serializePdfArtifact(value);
    assert.doesNotMatch(encoded, /elapsed_ms|timings/);
    const prepared = await preparePdfCapture(JSON.parse(encoded));
    assert.match(prepared.markdown, /^# Semantic title\n/);
    assert.match(prepared.markdown, /x\^\{2\} \\tag\{1\}/);
    assert.match(prepared.markdown, /\| Name \| Value \|/);
    assert.match(prepared.markdown, /\*\*bold\*\*/);
    assert.deepEqual(prepared.locationMap.entries, []);
    assert.equal(
        prepared.locationMap.contentHash,
        createHash("sha256").update(prepared.markdown).digest("hex"),
    );
    value.semanticDocument.timings.total_ms = 99;
    assert.equal(serializePdfArtifact(value), encoded);
});
test("legacy artifact serialization and capture remain byte compatible", async () => {
    const value = artifact();
    assert.equal(serializePdfArtifact(value), JSON.stringify(value));
    const digest = createHash("sha256")
        .update(JSON.stringify(value))
        .digest("hex");
    const result = await preparePdfCapture(value);
    assert.equal(result.artifactDigest, digest);
    assert.equal(
        result.markdown,
        `---\nschemaVersion: 1\nbyteHash: "${value.byteHash}"\nartifactDigest: "${digest}"\nextractorVersion: "legacy/1"\npdfjsVersion: "5.3.31"\ncoverage: [1]\n---\n\n## Page 1\n\nLegacy text`,
    );
    assert.equal(result.locationMap.entries.length, 1);
});
test("limits and pre-cancellation reject before page loading; during extraction leaves proxy usable", async () => {
    const pdf = await openPdf(fixturePdf(), {
        getDocumentOptions: { useSystemFonts: true, disableFontFace: true },
    });
    try {
        for (const name of ["maxPages", "maxBlocks", "maxTextChars"])
            await assert.rejects(
                extractPdfMarkdown(pdf, { [name]: 0 }),
                /Invalid/,
            );
        await assert.rejects(
            extractPdfMarkdown(
                new Proxy(pdf, {
                    get: (target, key) =>
                        key === "numPages"
                            ? 2
                            : Reflect.get(target, key, target),
                }),
                { maxPages: 1 },
            ),
            /maxPages/,
        );
        await assert.rejects(
            extractPdfMarkdown(pdf, { signal: AbortSignal.abort() }),
            /cancelled/,
        );
        await assert.rejects(
            extractPdfMarkdown(pdf, { maxTextChars: 5 }),
            /maxTextChars/,
        );
        await assert.rejects(
            extractPdfMarkdown(pdf, { maxBlocks: 1 }),
            /maxBlocks/,
        );
        const abort = new AbortController();
        await assert.rejects(
            extractPdfMarkdown(pdf, () => abort.abort(), {
                signal: abort.signal,
            }),
            /cancelled/,
        );
        assert.ok((await (await pdf.getPage(1)).getTextContent()).items.length);
    } finally {
        await pdf.destroy();
    }
});
