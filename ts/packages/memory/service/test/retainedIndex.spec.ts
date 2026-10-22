// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DocMemory,
    DocPart,
    DocPartMeta,
    createDocMemorySettings,
    type DocMemoryData,
} from "@typeagent/conversation-memory";
import { projectRetainedIndex } from "../src/retainedIndex.js";
import * as kp from "@typeagent/knowpro";

function part(id: string, chunks: string[]): DocPart {
    return new DocPart(
        chunks,
        new DocPartMeta(`typeagent-memory://sources/${id}/revisions/r1`),
    );
}

function fixture(): DocMemoryData {
    return {
        nameTag: "test",
        tags: [],
        messages: [
            part("private", ["FORGOTTEN_NEEDLE"]),
            part("kept", ["alpha", "beta"]),
            part("empty", ["nothing extracted"]),
            part("other", ["gamma"]),
        ],
        semanticRefs: [0, 1, 1, 3].map(
            (messageOrdinal, semanticRefOrdinal) => ({
                semanticRefOrdinal,
                range: { start: { messageOrdinal, chunkOrdinal: 0 } },
                knowledgeType: "topic",
                knowledge: {
                    text:
                        semanticRefOrdinal === 0
                            ? "FORGOTTEN_NEEDLE"
                            : "retained",
                },
            }),
        ),
        semanticIndexData: {
            items: [
                {
                    term: "FORGOTTEN_NEEDLE",
                    semanticRefOrdinals: [{ semanticRefOrdinal: 0, score: 1 }],
                },
                {
                    term: "retained",
                    semanticRefOrdinals: [
                        { semanticRefOrdinal: 1, score: 0.7 },
                        { semanticRefOrdinal: 2, score: 1 },
                        { semanticRefOrdinal: 3, score: 0.8 },
                    ],
                },
            ],
        },
        relatedTermsIndexData: {
            textEmbeddingData: {
                textItems: ["FORGOTTEN_NEEDLE", "retained"],
                embeddings: [
                    new Float32Array([1, 0]),
                    new Float32Array([0, 1]),
                ],
            },
        },
        messageIndexData: {
            messageCount: 4,
            indexData: {
                textLocations: [0, 1, 1, 2, 3].map((messageOrdinal, i) => ({
                    messageOrdinal,
                    chunkOrdinal: i === 2 ? 1 : 0,
                })),
                embeddings: [0, 1, 2, 3, 4].map(
                    (i) => new Float32Array([i, -i]),
                ),
            },
        },
        indexingState: {
            lastMessageOrdinal: 3,
            lastSemanticRefOrdinal: 3,
            lastIndexed: new Date(),
        },
    };
}

const lanes = { related: true, message: true };

describe("retained-source index projection", () => {
    test("retains exact knowledge, scores and vectors, remaps all ordinals, and isolates mutable backing", () => {
        const data = fixture();
        const expected = [data.messages[3], data.messages[1], data.messages[2]];
        const result = projectRetainedIndex(data, expected, lanes);
        if (!result.data) throw new Error(result.reason);
        const projected = result.data;
        expect(
            projected.semanticRefs.map((ref) => ref.semanticRefOrdinal),
        ).toEqual([0, 1, 2]);
        expect(
            projected.semanticRefs.map((ref) => ref.range.start.messageOrdinal),
        ).toEqual([1, 1, 0]);
        expect(
            projected.semanticIndexData!.items[0].semanticRefOrdinals,
        ).toEqual([
            { semanticRefOrdinal: 0, score: 0.7 },
            { semanticRefOrdinal: 1, score: 1 },
            { semanticRefOrdinal: 2, score: 0.8 },
        ]);
        expect(
            projected.messageIndexData!.indexData!.textLocations.map((x) => [
                x.messageOrdinal,
                x.chunkOrdinal,
            ]),
        ).toEqual([
            [1, 0],
            [1, 1],
            [2, 0],
            [0, 0],
        ]);
        expect(projected.messageIndexData!.indexData!.embeddings).toEqual(
            data.messageIndexData!.indexData!.embeddings.slice(1),
        );
        expect(
            projected.relatedTermsIndexData!.textEmbeddingData!.embeddings,
        ).toEqual([new Float32Array([0, 1])]);
        expect(JSON.stringify(projected)).not.toContain("FORGOTTEN_NEEDLE");
        projected.messageIndexData!.indexData!.embeddings[0][0] = 123;
        projected.messages[0].textChunks[0] = "mutated";
        expect(data.messages[3].textChunks[0]).toBe("gamma");
        expect(data.messageIndexData!.indexData!.embeddings[1][0]).toBe(1);
    });

    test.each(["text", "tags", "metadata", "missing-part"] as const)(
        "changed canonical %s disables reuse",
        (change) => {
            const data = fixture();
            const parts = structuredClone([data.messages[1]]);
            if (change === "text") parts[0].textChunks[0] += " changed";
            if (change === "tags") parts[0].tags.push("new");
            if (change === "metadata")
                parts[0].metadata.sourceUrl += "-new-revision";
            if (change === "missing-part")
                parts.push(part("absent", ["absent"]));
            expect(
                projectRetainedIndex(data, parts, lanes).reason,
            ).toBeDefined();
        },
    );

    test.each([
        "aliases",
        "range",
        "locations",
        "message-count",
        "part-coverage",
    ] as const)("unproven %s disables reuse explicitly", (change) => {
        const data = fixture();
        if (change === "aliases")
            data.relatedTermsIndexData!.aliasData = {
                relatedTerms: [
                    {
                        termText: "retained",
                        relatedTerms: [{ text: "private alias" }],
                    },
                ],
            };
        if (change === "range")
            data.semanticRefs[1].range.end = { messageOrdinal: 3 };
        if (change === "locations")
            data.messageIndexData!.indexData!.textLocations[2] = {
                messageOrdinal: 2,
                chunkOrdinal: 0,
            };
        if (change === "message-count") data.messageIndexData!.messageCount = 3;
        if (change === "part-coverage")
            data.messages.push(structuredClone(data.messages[1]));
        expect(
            projectRetainedIndex(data, [data.messages[1]], lanes).reason,
        ).toBeDefined();
    });

    test("partial vocabulary reuses available exact vectors and reports only retained terms needing backfill", () => {
        const data = fixture();
        data.relatedTermsIndexData!.textEmbeddingData!.textItems[1] =
            "unretained";
        const result = projectRetainedIndex(data, [data.messages[1]], lanes);
        expect(result.reason).toBeUndefined();
        expect(result.missingTermVectors).toBe(1);
        expect(result.data!.relatedTermsIndexData!.textEmbeddingData).toEqual({
            textItems: [],
            embeddings: [],
        });
        expect(result.data!.semanticRefs).toHaveLength(2);
    });

    test("preserves complete embedding windows and their ranges without aliasing", () => {
        const data = fixture();
        const index = data.messageIndexData!.indexData!;
        index.textLocations.splice(
            1,
            1,
            {
                messageOrdinal: 1,
                chunkOrdinal: 0,
                textRange: { start: 0, end: 2 },
            },
            {
                messageOrdinal: 1,
                chunkOrdinal: 0,
                textRange: { start: 2, end: 5 },
            },
        );
        index.embeddings.splice(
            1,
            1,
            new Float32Array([1, 0]),
            new Float32Array([0, 1]),
        );
        const projected = projectRetainedIndex(
            data,
            [data.messages[1]],
            lanes,
        ).data!;
        expect(
            projected.messageIndexData!.indexData!.textLocations,
        ).toHaveLength(3);
        projected.messageIndexData!.indexData!.textLocations[0].textRange!.end = 1;
        expect(index.textLocations[1].textRange!.end).toBe(2);
        index.textLocations[2].textRange!.start = 3;
        expect(
            projectRetainedIndex(data, [data.messages[1]], lanes).reason,
        ).toContain("window coverage");
        index.textLocations[2].textRange!.start = 1;
        expect(() =>
            projectRetainedIndex(data, [data.messages[1]], lanes),
        ).toThrow("Duplicate retained message-vector location");
    });

    test("malformed posting ordinals fail instead of becoming empty successful indexes", () => {
        const data = fixture();
        data.semanticIndexData!.items[1].semanticRefOrdinals[0].semanticRefOrdinal = 100;
        expect(() =>
            projectRetainedIndex(data, [data.messages[1]], lanes),
        ).toThrow("Invalid retained term posting");
    });

    test.each(["unknown", "partial", "uncertified"])(
        "rejects %s completion independently of adapter gating",
        (state) => {
            const data = fixture();
            if (state === "unknown") delete data.indexingState;
            else if (state === "partial")
                data.indexingState!.lastMessageOrdinal = 1;
            else data.indexingComplete = false;
            expect(
                projectRetainedIndex(data, [data.messages[1]], lanes).reason,
            ).toBe("Committed indexing completion is unknown or partial");
        },
    );

    test("empty extracted knowledge survives and disabled lanes do not retain old vectors", () => {
        const data = fixture();
        const projected = projectRetainedIndex(data, [data.messages[2]], {
            related: false,
            message: false,
        }).data!;
        expect(projected.messages).toHaveLength(1);
        expect(projected.semanticRefs).toEqual([]);
        expect(projected.relatedTermsIndexData).toEqual({});
        expect(projected.messageIndexData!.messageCount).toBe(1);
        expect(projected.messageIndexData!.indexData!.embeddings).toEqual([]);
    });
});

test("missing completion provenance cannot become certified by deserialize or append", async () => {
    const previous = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
    process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
    try {
        const settings = createDocMemorySettings(64, undefined, {
            completionSettings: {},
            complete: async () => {
                throw new Error("Unexpected chat");
            },
        });
        settings.conversationSettings.semanticRefIndexSettings.autoExtractKnowledge =
            false;
        const memory = new DocMemory("test", [part("one", ["text"])], settings);
        expect(memory.hasCompleteIndex).toBe(false);
        await memory.buildIndex();
        expect(memory.hasCompleteIndex).toBe(true);
        const data = await memory.serialize();
        delete data.indexingState;
        const restored = new DocMemory("test", [], settings);
        await restored.deserialize(data);
        expect(restored.hasCompleteIndex).toBe(false);
        restored.messages.append(part("two", ["new text"]));
        await restored.addToIndex();
        expect(restored.hasCompleteIndex).toBe(false);
        expect((await restored.serialize()).indexingComplete).toBe(false);
        await restored.buildIndex();
        expect(restored.hasCompleteIndex).toBe(true);
        settings.conversationSettings.semanticRefIndexSettings.autoExtractKnowledge =
            true;
        settings.conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
            {
                settings: { maxContextLength: 1000 },
                extract: async () => ({
                    entities: [],
                    topics: [],
                    actions: [],
                    inverseActions: [],
                }),
                extractWithRetry: async () => ({
                    success: true,
                    data: {
                        entities: [],
                        topics: [],
                        actions: [],
                        inverseActions: [],
                    },
                }),
            };
        await restored.buildIndex({ onKnowledgeExtracted: () => false });
        expect(restored.hasCompleteIndex).toBe(false);
        const projected = projectRetainedIndex(
            fixture(),
            [fixture().messages[1]],
            {
                related: false,
                message: false,
            },
        );
        if (!projected.data) throw new Error(projected.reason);
        const offline = new DocMemory("test", [], settings);
        await offline.deserialize(projected.data);
        await kp.buildRelatedTermsIndex(
            offline,
            settings.conversationSettings.relatedTermIndexSettings,
        );
        expect(
            await offline.secondaryIndexes.termToRelatedTermsIndex.fuzzyIndex!.lookupTerm(
                "retaine",
                1,
                1,
            ),
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ text: "retained" }),
            ]),
        );
        expect((await restored.serialize()).indexingComplete).toBe(false);
        await restored.buildIndex();
        expect(restored.hasCompleteIndex).toBe(true);
        settings.conversationSettings.semanticRefIndexSettings.knowledgeExtractor.extractWithRetry =
            async () => {
                throw new Error("Controlled extraction failure");
            };
        await expect(restored.buildIndex()).rejects.toThrow(
            "Controlled extraction failure",
        );
        expect(restored.hasCompleteIndex).toBe(false);
        await expect(
            restored.addDocPartToIndex(part("three", ["retry this chunk"])),
        ).rejects.toThrow("Controlled extraction failure");
        const failed = await restored.serialize();
        expect(failed.indexingState!.lastMessageOrdinal).toBe(1);
        expect(failed.indexingComplete).toBe(false);
        const retry = new DocMemory("test", [], settings);
        await retry.deserialize(failed);
        const extracted: string[] = [];
        settings.conversationSettings.semanticRefIndexSettings.knowledgeExtractor.extractWithRetry =
            async (text) => {
                extracted.push(text);
                return {
                    success: true,
                    data: {
                        entities: [],
                        topics: [],
                        actions: [],
                        inverseActions: [],
                    },
                };
            };
        await retry.addToIndex();
        expect(extracted).toEqual(["retry this chunk"]);
        expect(retry.hasCompleteIndex).toBe(false);
    } finally {
        if (previous === undefined)
            delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        else process.env.TYPEAGENT_EMBEDDING_PROVIDER = previous;
    }
});
