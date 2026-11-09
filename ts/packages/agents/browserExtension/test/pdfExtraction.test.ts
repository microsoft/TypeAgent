// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** @jest-environment node */

import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import {
    preparePdfCapture,
    serializePdfArtifact,
} from "@typeagent/browser-control-rpc/pdfMarkdown";
import { pdfSemanticFixture } from "./pdfSemanticFixture";

Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
});

beforeAll(() => {
    Object.assign(globalThis, { TextEncoder });
});

describe("semantic PDF capture", () => {
    it("round-trips upstream headings, formula LaTeX, tables and emphasis", async () => {
        const artifact = pdfSemanticFixture();
        artifact.semanticDocument = {
            pages: [
                {
                    number: 1,
                    blocks: [
                        { type: "heading", text: "Document title", level: 1 },
                        {
                            type: "formula",
                            text: "x2",
                            latex: "x^{2}",
                            number: "(2)",
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
                            text: "Important",
                            runs: [{ text: "Important", bold: true }],
                        },
                    ],
                },
            ],
        };
        const result = await preparePdfCapture(
            JSON.parse(serializePdfArtifact(artifact)),
        );
        expect(result.markdown).toContain("# Document title\n");
        expect(result.markdown).toContain("x^{2} \\tag{2}");
        expect(result.markdown).toContain("| Name | Value |");
        expect(result.markdown).toContain("**Important**");
        expect(result.markdown).not.toMatch(/^---|## Page/);
        expect(result.locationMap.entries).toEqual([]);
        expect(result.artifactDigest).toMatch(/^[a-f0-9]{64}$/);
    });
    it("strips transient geometry, metadata, timing and image data from semantic ingestion", async () => {
        const artifact = pdfSemanticFixture();
        const semantic = {
            ...artifact.semanticDocument!,
            elapsed_ms: 99,
            timings: { total_ms: 123 },
            metadata: { title: "transient" },
        };
        artifact.semanticDocument = semantic;
        const block = semantic.pages[0].blocks[0];
        Object.assign(block, {
            bbox: [1, 2, 3, 4],
            style: { size: 12 },
            image: { name: "secret.png", data: "private" },
        });
        const serialized = serializePdfArtifact(artifact);
        const normalized = JSON.parse(serialized).semanticDocument;
        expect(normalized).toEqual({
            pages: [
                {
                    number: 1,
                    blocks: [{ type: "paragraph", text: "Manual text" }],
                },
            ],
        });
        expect((await preparePdfCapture(artifact)).markdown).toBe(
            "Manual text\n",
        );
        const originalDigest = (await preparePdfCapture(artifact))
            .artifactDigest;
        semantic.elapsed_ms = 999;
        expect((await preparePdfCapture(artifact)).artifactDigest).toBe(
            originalDigest,
        );
        block.text = "Changed";
        expect((await preparePdfCapture(artifact)).artifactDigest).not.toBe(
            originalDigest,
        );
    });
    it("keeps legacy saved artifacts byte stable and read compatible", async () => {
        const artifact = pdfSemanticFixture();
        delete artifact.semanticDocument;
        expect(serializePdfArtifact(artifact)).toBe(JSON.stringify(artifact));
        const result = await preparePdfCapture(artifact);
        expect(result.markdown).toContain("## Page 1\n\nManual text");
        expect(result.locationMap.entries).toHaveLength(1);
        expect(result.locationMap.entries[0].blockId).toBe("p1-b0");
    });
});
