// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    InProcessMemoryServiceClient,
    McpMemoryServiceClient,
} from "../dist/memoryClient.js";
import {
    wikiAmbiguityReviewActionSchema,
    wikiAmbiguityReviewSchema,
    wikiAmbiguityToolNames,
} from "../dist/wikiAmbiguityProtocol.js";

const request = {
    corpusId: "corpus",
    reviewId: "review",
    expectedVersion: 3,
    action: "keep_separate",
};
const review = {
    id: "review",
    corpusId: "corpus",
    jobId: "job",
    candidateId: "candidate",
    version: 3,
    createdAt: "2026-11-18T00:00:00Z",
    updatedAt: "2026-11-18T00:00:00Z",
    state: "needsReview",
    reason: "Synthetic evidence needs review",
    assessment: { disposition: "ambiguous" },
    participants: [
        {
            id: "candidate",
            revisionId: null,
            input: {
                definition: { kind: "wiki" },
                inputs: [],
                fingerprint: "f".repeat(64),
            },
        },
    ],
    request: {
        model: "GPT_6_1_SOL",
        logicalRequests: 1,
        state: "interrupted",
        transportRetries: 0,
    },
};

test("review protocol retains one-shot reservation, original evidence and optional verification", () => {
    const recorded = {
        ...review,
        request: { ...review.request, raw: { proposal: "original response" } },
        verification: [{ error: "Source access changed during verification" }],
    };
    assert.deepEqual(wikiAmbiguityReviewSchema.parse(recorded), recorded);
    for (const invalid of [
        { ...recorded, request: { ...recorded.request, logicalRequests: 2 } },
        { ...recorded, request: { ...recorded.request, model: "fallback" } },
        { ...recorded, version: 0 },
    ])
        assert.equal(
            wikiAmbiguityReviewSchema.safeParse(invalid).success,
            false,
        );
});

test("resolution actions require exact guards and edit-only complete proposals", () => {
    assert.deepEqual(wikiAmbiguityReviewActionSchema.parse(request), request);
    const resolution = {
        status: "resolved",
        reason: "Retain independent subjects",
        groups: [
            {
                action: "keep_separate",
                ids: ["candidate"],
                survivorId: null,
                combined: null,
                sections: [],
            },
        ],
    };
    assert.equal(
        wikiAmbiguityReviewActionSchema.safeParse({
            ...request,
            action: "edit",
            resolution,
        }).success,
        true,
    );
    for (const invalid of [
        { ...request, expectedVersion: 0 },
        { ...request, expectedVersion: undefined },
        { ...request, reviewId: "../review" },
        { ...request, action: "publish" },
        { ...request, action: "edit" },
        { ...request, resolution },
        { ...request, actor: "memory-view-generator" },
        { ...request, action: "edit", resolution: { status: "resolved" } },
    ])
        assert.equal(
            wikiAmbiguityReviewActionSchema.safeParse(invalid).success,
            false,
        );
});

test("in-process and MCP clients preserve review actions and reject invalid input before invocation", async () => {
    const calls = [];
    const inProcess = new InProcessMemoryServiceClient({
        listWikiAmbiguityReviews: async (corpusId) => {
            calls.push(["list", { corpusId }]);
            return [review];
        },
        resolveWikiAmbiguityReview: async (input) => {
            calls.push(["resolve", input]);
            return review;
        },
    });
    const mcp = new McpMemoryServiceClient({
        callTool: async ({ name, arguments: args }) => {
            calls.push([name, args]);
            return {
                content: [],
                structuredContent: {
                    result:
                        name === wikiAmbiguityToolNames.list
                            ? [review]
                            : review,
                },
            };
        },
    });
    for (const client of [inProcess, mcp]) {
        assert.deepEqual(await client.listWikiAmbiguityReviews("corpus"), [
            review,
        ]);
        assert.deepEqual(
            await client.resolveWikiAmbiguityReview(request),
            review,
        );
        assert.throws(() => client.listWikiAmbiguityReviews("../corpus"));
        assert.throws(() =>
            client.resolveWikiAmbiguityReview({
                ...request,
                expectedVersion: undefined,
            }),
        );
    }
    assert.deepEqual(calls, [
        ["list", { corpusId: "corpus" }],
        ["resolve", request],
        [wikiAmbiguityToolNames.list, { corpusId: "corpus" }],
        [wikiAmbiguityToolNames.resolve, request],
    ]);
});

test("missing capability, service conflicts and malformed MCP replies remain errors", async () => {
    const missing = new InProcessMemoryServiceClient({});
    await assert.rejects(
        () => missing.listWikiAmbiguityReviews("corpus"),
        /Wiki ambiguity review/,
    );
    const conflict = new InProcessMemoryServiceClient({
        resolveWikiAmbiguityReview: async () => {
            throw new Error("Wiki review version conflict");
        },
    });
    await assert.rejects(
        () => conflict.resolveWikiAmbiguityReview(request),
        /Wiki review version conflict/,
    );
    const mcp = new McpMemoryServiceClient({
        callTool: async () => ({
            content: [],
            structuredContent: {
                result: {
                    ...review,
                    request: { ...review.request, logicalRequests: 2 },
                },
            },
        }),
    });
    await assert.rejects(() => mcp.resolveWikiAmbiguityReview(request));
});
