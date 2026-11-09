// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
    ingestRequestSchema,
    revisionSchema,
    sourceReplaceRequestSchema,
    sourceSchema,
    searchResultSchema,
} from "../dist/protocol.js";

const markdown = "# Zephyr\n\nSource-attributed recovery report.\n";
const contentHash = createHash("sha256").update(markdown).digest("hex");
const source = {
    sourceId: "source",
    sourceType: "markdown",
    title: "Zephyr report",
    canonicalUri: "https://memory.test/report.pdf",
    markdown,
    tags: ["report"],
    metadata: { producer: "pdf", artifactId: "report" },
    capturedAt: "2026-10-01T12:00:00.000Z",
    contentHash,
};
const revision = {
    revisionId: contentHash,
    sourceId: source.sourceId,
    contentHash,
    mimeType: "text/markdown",
    pipelineVersion: "1",
    pipeline: { mode: "content", maxCharsPerChunk: 1000 },
    state: "ready",
};
const legacyLocationMap = {
    schemaVersion: 99,
    contentHash: "obsolete",
    entries: null,
};

test("Markdown import and replacement preserve source identity and producer metadata", () => {
    assert.deepEqual(
        ingestRequestSchema.parse({ corpusId: "corpus", source }).source,
        source,
    );
    const { sourceId: _sourceId, ...replacement } = source;
    assert.deepEqual(
        sourceReplaceRequestSchema.parse({
            corpusId: "corpus",
            sourceId: "source",
            expectedActiveRevisionId: contentHash,
            source: replacement,
        }).source,
        replacement,
    );
});

test("retired optional maps are ignored rather than validated or published", () => {
    assert.deepEqual(
        ingestRequestSchema.parse({
            corpusId: "corpus",
            source: { ...source, locationMap: legacyLocationMap },
        }).source,
        source,
    );
    const { sourceId: _sourceId, ...replacement } = source;
    assert.deepEqual(
        sourceReplaceRequestSchema.parse({
            corpusId: "corpus",
            sourceId: "source",
            expectedActiveRevisionId: contentHash,
            source: { ...replacement, locationMap: legacyLocationMap },
        }).source,
        replacement,
    );
    assert.deepEqual(
        revisionSchema.parse({ ...revision, locationMap: legacyLocationMap }),
        revision,
    );
    const savedSource = {
        sourceId: source.sourceId,
        corpusId: "corpus",
        sourceType: source.sourceType,
        title: source.title,
        canonicalUri: source.canonicalUri,
        metadata: source.metadata,
        activeRevisionId: contentHash,
        revisions: [revision],
    };
    assert.deepEqual(
        sourceSchema.parse({
            ...savedSource,
            revisions: [{ ...revision, locationMap: legacyLocationMap }],
        }),
        savedSource,
    );
});

test("source-attributed excerpts remain usable without page or block projections", () => {
    const evidence = {
        evidenceId: "evidence",
        corpusId: "corpus",
        sourceId: "source",
        revisionId: contentHash,
        title: source.title,
        canonicalUri: source.canonicalUri,
        locator: "message:0",
        snippet: markdown,
        score: 1,
        sourceType: "markdown",
        indexedAt: "2026-10-01T12:00:00.000Z",
    };
    const result = {
        query: "Zephyr",
        matches: [evidence],
        truncated: false,
        warnings: [],
        capabilitiesUsed: [],
        indexVersion: "1",
    };
    const parsed = searchResultSchema.parse({
        ...result,
        matches: [
            {
                ...evidence,
                canonicalRanges: [{ start: 0, end: 1 }],
                locations: [{ page: 1 }],
            },
        ],
    });
    assert.deepEqual(parsed.matches, [evidence]);
});
