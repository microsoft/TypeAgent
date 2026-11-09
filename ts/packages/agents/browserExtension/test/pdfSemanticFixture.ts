// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PdfExtractionArtifact } from "@typeagent/browser-control-rpc/pdfMarkdown";
export function pdfSemanticFixture(
    text = "Manual text",
    byteHash = "a".repeat(64),
): PdfExtractionArtifact {
    return {
        schemaVersion: 1,
        extractorVersion: "pdfToMarkdown/test",
        pdfjsVersion: "5.3.31",
        byteHash,
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
                bbox: [40, 40, 200, 60],
                text,
            },
        ],
        warnings: [],
        coverage: [1],
        semanticDocument: {
            pages: [{ number: 1, blocks: [{ type: "paragraph", text }] }],
        },
    };
}
