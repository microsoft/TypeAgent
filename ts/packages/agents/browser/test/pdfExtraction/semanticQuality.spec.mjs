// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { getDocument, version } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
    extractPdfMarkdown,
    preparePdfCapture,
    serializePdfArtifact,
    renderPdfSemanticDocument,
} from "@typeagent/browser-control-rpc/pdfMarkdown";
import {
    representativeFixtures,
    sha256,
    withPdfGenerator,
} from "./fixtures.mjs";

test("generated PDFs preserve semantic content and stable canonical Markdown", async (suite) => {
    await withPdfGenerator(async (generator) => {
        const fixtures = await representativeFixtures(generator);
        const duplicate = await representativeFixtures(generator);
        assert.deepEqual(
            fixtures.map((fixture) => sha256(fixture.bytes)),
            duplicate.map((fixture) => sha256(fixture.bytes)),
        );
        for (const fixture of fixtures) {
            await suite.test(fixture.name, async () => {
                const document = await getDocument({
                    data: new Uint8Array(fixture.bytes),
                    fontExtraProperties: true,
                    isEvalSupported: false,
                }).promise;
                try {
                    const options = {
                        byteHash: sha256(fixture.bytes),
                        pdfjsVersion: version,
                    };
                    if (fixture.name === "scan-only") {
                        await assert.rejects(
                            extractPdfMarkdown(document, options),
                            /OCR is not supported/,
                        );
                        return;
                    }
                    const result = await extractPdfMarkdown(document, options);
                    const artifact = result.artifact;
                    assert.equal(
                        artifact.semanticDocument.pages.length,
                        document.numPages,
                    );
                    assert.equal(
                        result.markdown,
                        renderPdfSemanticDocument(artifact.semanticDocument, {
                            math: "latex",
                            images: "none",
                            pageBreaks: false,
                        }),
                    );
                    assert.doesNotMatch(result.markdown, /^---|## Page \d/);
                    const semanticText = artifact.semanticDocument.pages
                        .flatMap((page) => page.blocks)
                        .map((block) =>
                            [block.text, ...(block.rows ?? []).flat()].join(
                                " ",
                            ),
                        )
                        .join(" ");
                    for (const expected of fixture.expected ?? [])
                        assert.ok(
                            semanticText.includes(expected),
                            `retained semantic content: ${expected}`,
                        );
                    if (fixture.name === "lists-furniture") {
                        assert.match(result.markdown, /First item/);
                        assert.match(result.markdown, /Second item/);
                        assert.ok(
                            artifact.semanticDocument.pages.some((page) =>
                                page.blocks.some(
                                    (block) => block.type === "list_item",
                                ),
                            ),
                        );
                        assert.doesNotMatch(result.markdown, /Repeated manual/);
                    }
                    if (fixture.name === "tables-math-captions") {
                        for (const expected of [
                            "Name",
                            "Value",
                            "Alpha",
                            "42",
                            "x = y + 2",
                            "Figure 1: sample caption",
                            "café office affine",
                        ])
                            assert.ok(
                                semanticText.includes(expected),
                                expected,
                            );
                    }
                    if (fixture.name === "mixed-scan") {
                        assert.deepEqual(result.emptyPages, [2]);
                        assert.deepEqual(artifact.coverage, [1, 0]);
                        assert.doesNotMatch(
                            result.markdown,
                            /Scan text requires OCR/,
                        );
                    }
                    const serialized = serializePdfArtifact(artifact);
                    assert.doesNotMatch(
                        serialized,
                        /elapsed_ms|timings|font_size/,
                    );
                    const prepared = await preparePdfCapture(artifact);
                    assert.equal(prepared.markdown, result.markdown);
                    assert.deepEqual(prepared.locationMap.entries, []);
                    assert.deepEqual(
                        await preparePdfCapture(JSON.parse(serialized)),
                        prepared,
                    );
                    assert.deepEqual(
                        await preparePdfCapture(
                            (await extractPdfMarkdown(document, options))
                                .artifact,
                        ),
                        prepared,
                    );
                    for (const block of artifact.blocks) {
                        const page = artifact.pages[block.page - 1];
                        assert.ok(block.bbox.every(Number.isFinite));
                        assert.ok(
                            block.bbox[0] >= 0 &&
                                block.bbox[1] >= 0 &&
                                block.bbox[2] <= page.width &&
                                block.bbox[3] <= page.height,
                        );
                    }
                } finally {
                    await document.destroy();
                }
            });
        }
    });
});
