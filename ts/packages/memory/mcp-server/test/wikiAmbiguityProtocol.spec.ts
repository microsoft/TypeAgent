// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    InProcessMemoryServiceClient,
    McpMemoryServiceClient,
    wikiAmbiguityReviewSchema,
} from "@typeagent/memory-client";
import {
    FileMemoryService,
    createMemoryServiceRpcFacade,
    type WikiAmbiguityReview,
    type WikiAmbiguityReviewAction,
} from "@typeagent/memory-service";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";

const review: WikiAmbiguityReview = {
    id: "review",
    corpusId: "corpus",
    jobId: "job",
    candidateId: "candidate",
    version: 3,
    createdAt: "2026-11-18T00:00:00Z",
    updatedAt: "2026-11-18T00:00:00Z",
    state: "needsReview",
    reason: "Synthetic unresolved identity; complete evidence retained",
    assessment: {
        disposition: "ambiguous",
        purpose: "Synthetic subject",
        reason: "uncertain",
        canonicalViewId: "",
        sharedFragmentIds: [],
        ambiguousViewIds: [],
        essentialDistinctions: [],
    },
    participants: [
        {
            id: "candidate",
            revisionId: null,
            input: {
                corpusId: "corpus",
                actor: "test",
                model: "offline",
                fingerprint: "f".repeat(64),
                definition: {
                    viewId: "candidate",
                    kind: "wiki",
                    selector: { kind: "sources", sources: [] },
                },
                expectedVersion: 0,
                bounds: {},
                pipeline: "informational-wiki-v1",
                inputs: [
                    {
                        sourceId: "source",
                        revisionId: "r1",
                        title: "Synthetic source",
                        content: "Original evidence beyond generated prose.",
                        contentHash: "a".repeat(64),
                    },
                ],
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

class ReviewFixture extends FileMemoryService {
    actions: WikiAmbiguityReviewAction[] = [];

    override async listWikiAmbiguityReviews(corpusId: string) {
        if (corpusId !== review.corpusId)
            throw new Error("Wrong synthetic review corpus");
        return [structuredClone(review)];
    }

    override async resolveWikiAmbiguityReview(
        request: WikiAmbiguityReviewAction,
    ): Promise<WikiAmbiguityReview> {
        if (
            request.corpusId !== review.corpusId ||
            request.reviewId !== review.id ||
            request.expectedVersion !== review.version
        )
            throw new Error("Wiki review version conflict");
        this.actions.push(structuredClone(request));
        return { ...structuredClone(review), state: "resolved", version: 4 };
    }
}

test("complete source-bound reviews and guarded actions survive actual MCP HTTP, in-process and RPC paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wiki-review-protocol-"));
    const service = new ReviewFixture(root, {
        viewDrafts: false,
        informationalViews: false,
        discoveryPolicy: "off",
    });
    const host = await MemoryServiceHost.start(service);
    const client = await McpMemoryServiceClient.create({
        kind: "http",
        url: host.endpoint,
        headers: { Authorization: `Bearer ${host.bearerToken}` },
    });
    try {
        for (const transport of [
            new InProcessMemoryServiceClient(service),
            createMemoryServiceRpcFacade(service),
            client,
        ]) {
            const records = await transport.listWikiAmbiguityReviews("corpus");
            expect(records).toEqual([review]);
            expect(wikiAmbiguityReviewSchema.parse(records[0])).toEqual(review);
            expect(
                (
                    await transport.resolveWikiAmbiguityReview({
                        corpusId: "corpus",
                        reviewId: "review",
                        expectedVersion: 3,
                        action: "keep_separate",
                    })
                ).state,
            ).toBe("resolved");
            await expect(
                transport.resolveWikiAmbiguityReview({
                    corpusId: "corpus",
                    reviewId: "review",
                    expectedVersion: 2,
                    action: "approve",
                }),
            ).rejects.toThrow("Wiki review version conflict");
        }
        expect(service.actions).toHaveLength(3);
    } finally {
        await client.close();
        await host.close();
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});
