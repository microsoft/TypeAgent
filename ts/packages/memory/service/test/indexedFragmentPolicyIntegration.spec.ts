// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createDocMemorySettings } from "@typeagent/conversation-memory";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { createKnowProCorpusIndex } from "../src/knowProCorpusIndex.js";
import type { IndexedBlock } from "../src/indexedFragments.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

const languageModel = {
    completionSettings: {},
    complete: async () => ({
        success: true as const,
        data: JSON.stringify({
            searchExpressions: [
                {
                    rewrittenQuery: "Missing entity",
                    filters: [
                        {
                            entitySearchTerms: [
                                {
                                    name: "Missing entity",
                                    isNamePronoun: false,
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
    }),
};

function settings() {
    const value = createDocMemorySettings(64, undefined, languageModel);
    value.embeddingSize = 0;
    const knowledge = {
        entities: [{ name: "Fixture", type: ["document"] }],
        topics: ["background"],
        actions: [],
        inverseActions: [],
    };
    value.conversationSettings.semanticRefIndexSettings.knowledgeExtractor = {
        settings: { maxContextLength: 1000 },
        extract: async () => knowledge,
        extractWithRetry: async () => ({
            success: true as const,
            data: knowledge,
        }),
    };
    return value;
}

describe("native fragment policy integration", () => {
    let root: string;
    let service: FileMemoryService;
    let previousProvider: string | undefined;
    let enabled: boolean;
    let observed: IndexedBlock[];
    let nativeCount: number;

    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "fragment-policy-"));
        previousProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
        enabled = false;
        observed = [];
        nativeCount = -1;
        service = new FileMemoryService(root, {
            maintenanceMode: "manual",
            informationalViews: false,
            eventIndexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
            indexFactory: (corpusId, directory) =>
                createKnowProCorpusIndex(corpusId, directory, settings, {
                    selectBlocks: ({ nativeBlocks, eligibleBlocks }) => {
                        observed = [...eligibleBlocks];
                        nativeCount = nativeBlocks.length;
                        if (!enabled) return [...nativeBlocks];
                        return eligibleBlocks
                            .filter((block) =>
                                block.text.includes("Rare price"),
                            )
                            .map((block) => ({ ...block, score: 100 }));
                    },
                }),
        });
    });

    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
        if (previousProvider === undefined)
            delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        else process.env.TYPEAGENT_EMBEDDING_PROVIDER = previousProvider;
    });

    async function ingest(corpusId: string, sourceId: string, text: string) {
        const result = await service.ingestDocument({
            corpusId,
            source: { sourceId, sourceType: "text", title: sourceId, text },
        });
        await waitForMemoryJob(service, result.jobId);
        return result;
    }

    test("recovers a raw native block absent from semantic candidates without widening source scope", async () => {
        const { corpusId } = await service.createCorpus("Policy");
        await ingest(corpusId, "budget", "Budget background only.");
        await ingest(corpusId, "price", "Rare price is 200000.");
        const request = {
            corpusId,
            query: "What is the rare price?",
            indexedFragments: true,
            includeDiagnostics: true,
        };
        const baseline = await service.search(request);
        expect(nativeCount).toBe(0);
        expect(baseline.matches).toHaveLength(0);
        enabled = true;
        const recovered = await service.search(request);
        expect(recovered.matches).toHaveLength(1);
        expect(recovered.matches[0].sourceId).toBe("price");
        expect(recovered.matches[0].snippet).toContain("200000");
        expect(recovered.matches[0].locator).toMatch(/^indexed:/u);
        const scoped = await service.search({
            ...request,
            sourceIds: ["budget"],
        });
        expect(observed.map((block) => block.sourceId)).toEqual(["budget"]);
        expect(scoped.matches).toHaveLength(0);
    });

    test("eligible raw blocks exclude superseded revisions and other corpora", async () => {
        const { corpusId } = await service.createCorpus("Primary");
        const old = await ingest(corpusId, "price", "Rare price is 200000.");
        const current = await ingest(
            corpusId,
            "price",
            "Rare price is now 300000.",
        );
        const other = await service.createCorpus("Other");
        await ingest(other.corpusId, "foreign", "Rare price is 999999.");
        enabled = true;
        const result = await service.search({
            corpusId,
            query: "What is the rare price?",
            indexedFragments: true,
        });
        expect(result.matches).toHaveLength(1);
        expect(result.matches[0].snippet).toContain("300000");
        expect(result.matches[0].revisionId).toBe(current.revisionId);
        expect(observed.every((block) => block.sourceId === "price")).toBe(
            true,
        );
        expect(
            observed.every((block) => block.revisionId !== old.revisionId),
        ).toBe(true);
    });
});
