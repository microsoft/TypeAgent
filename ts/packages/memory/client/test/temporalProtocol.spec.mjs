// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { answerResultSchema, searchResultSchema } from "../dist/index.js";

const value = {
    raw: "2026-10-29T06:15:05Z",
    kind: "instant",
    precision: "second",
    localDateTime: "2026-10-29T06:15:05",
    instantUtc: "2026-10-29T06:15:05.000Z",
    offsetMinutes: 0,
};
const temporalContext = {
    version: 1,
    sourceRevisionId: "revision",
    contextHash: "context",
    sourceContextHash: "source-context",
    ownerId: "document",
    partOrdinal: 0,
    role: "document",
    sourceSpan: { start: 0, end: 100 },
    messageTime: value,
    inheritedDateEvidence: [
        {
            id: "inherited",
            role: "messageTime",
            locator: "chars:0-20",
            value,
        },
    ],
    discoveredDateEvidence: [
        {
            id: "discovered",
            role: "eventTime",
            locator: "chars:21-40",
            value,
            quote: "2026-10-29T06:15:05Z",
            chunkOrdinal: 0,
        },
    ],
    rejectedDateAnchors: [
        { chunkOrdinal: 0, anchorOrdinal: 1, reason: "quote-not-found" },
    ],
    eventMentions: [
        {
            chunkOrdinal: 0,
            text: "an earlier event",
            start: 41,
            end: 57,
            role: "eventTime",
            resolution: "missing-anchor",
        },
    ],
};
const evidence = {
    evidenceId: "evidence",
    corpusId: "corpus",
    sourceId: "source",
    revisionId: "revision",
    title: "Intermediate investigation record",
    snippet: "A declared investigation plan.",
    score: 1,
    sourceType: "text",
    indexedAt: "2026-10-29T06:15:05Z",
    temporalContext,
};
const answer = {
    question: "What was planned?",
    answer: "The retained record declares a plan.",
    mode: "synthesized",
    citations: [evidence],
    grounded: true,
    indexVersion: "index",
    warnings: [],
};

test("search and synthesized-answer citations retain complete source temporal provenance", () => {
    assert.deepEqual(
        answerResultSchema.parse(JSON.parse(JSON.stringify(answer))),
        answer,
    );
    const search = {
        query: "investigation plans",
        matches: [evidence],
        warnings: [],
        capabilitiesUsed: [],
        indexVersion: "index",
    };
    assert.deepEqual(
        searchResultSchema.parse(JSON.parse(JSON.stringify(search))),
        search,
    );
});

test("MCP JSON Schema admits temporal citations without weakening additional-property checks", () => {
    const context =
        z.toJSONSchema(answerResultSchema).properties.citations.items.properties
            .temporalContext;
    assert.equal(context.type, "object");
    assert.equal(context.additionalProperties, false);
    assert.equal(context.properties.version.const, 1);
    assert.equal(context.properties.sourceSpan.additionalProperties, false);
    assert.equal(
        context.properties.eventMentions.items.additionalProperties,
        false,
    );
});

test("malformed temporal contexts are rejected rather than stripped or inferred", () => {
    for (const context of [
        { ...temporalContext, version: 2 },
        { ...temporalContext, sourceSpan: { start: -1, end: 100 } },
        { ...temporalContext, unexpectedPrompt: "not provenance" },
        {
            ...temporalContext,
            rejectedDateAnchors: [
                { chunkOrdinal: 0, anchorOrdinal: 1, reason: "made-up" },
            ],
        },
        {
            ...temporalContext,
            eventMentions: [
                { ...temporalContext.eventMentions[0], resolution: "guessed" },
            ],
        },
    ]) {
        assert.equal(
            answerResultSchema.safeParse({
                ...answer,
                citations: [{ ...evidence, temporalContext: context }],
            }).success,
            false,
        );
    }
});

test("legacy evidence does not acquire synthetic temporal context", () => {
    const legacy = { ...evidence };
    delete legacy.temporalContext;
    const parsed = answerResultSchema.parse({ ...answer, citations: [legacy] });
    assert.equal(Object.hasOwn(parsed.citations[0], "temporalContext"), false);
});
