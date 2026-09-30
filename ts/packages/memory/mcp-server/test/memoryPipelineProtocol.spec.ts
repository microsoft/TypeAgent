// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ingestRequestSchema, revisionSchema } from "@typeagent/memory-client";

const source = {
    sourceType: "markdown",
    title: "Service X recovery",
    markdown: "# Recovery\nInspect database connection limits.",
};

const revision = {
    revisionId: "revision-1",
    sourceId: "source-1",
    contentHash: "fixture",
    mimeType: "text/markdown",
    pipelineVersion: "1",
    state: "ready",
};

describe("canonical memory processing protocol", () => {
    test("accepts the content pipeline, optional mode, and advanced chunk sizing", () => {
        expect(
            ingestRequestSchema.parse({ corpusId: "corpus-1", source }),
        ).toEqual({ corpusId: "corpus-1", source });
        expect(
            ingestRequestSchema.parse({
                corpusId: "corpus-1",
                source,
                pipeline: { maxCharsPerChunk: 8_000 },
            }).pipeline,
        ).toEqual({ maxCharsPerChunk: 8_000 });
        expect(
            ingestRequestSchema.parse({
                corpusId: "corpus-1",
                source,
                pipeline: { mode: "content", maxCharsPerChunk: 8_000 },
            }).pipeline,
        ).toEqual({ mode: "content", maxCharsPerChunk: 8_000 });
        expect(
            revisionSchema.parse({
                ...revision,
                pipeline: { mode: "content", maxCharsPerChunk: 8_000 },
            }).pipeline,
        ).toEqual({ mode: "content", maxCharsPerChunk: 8_000 });
    });

    test.each(["basic", "summary", "full"])(
        "rejects the removed %s mode rather than mapping it to another pipeline",
        (mode) => {
            expect(
                ingestRequestSchema.safeParse({
                    corpusId: "corpus-1",
                    source,
                    pipeline: { mode },
                }).success,
            ).toBe(false);
            expect(
                revisionSchema.safeParse({
                    ...revision,
                    pipeline: { mode },
                }).success,
            ).toBe(false);
        },
    );
});
