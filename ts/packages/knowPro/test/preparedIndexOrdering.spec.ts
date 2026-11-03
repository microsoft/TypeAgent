// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { prepareInOrder } from "../src/preparedIndexing.js";
import { buildConversationIndex } from "../src/conversationIndex.js";
import { createConversationSettings } from "../src/conversation.js";
import { ConversationSecondaryIndexes } from "../src/secondaryIndexes.js";
import { MessageCollection, SemanticRefCollection } from "../src/storage.js";
import { TermToSemanticRefIndex } from "../src/conversationIndex.js";
import type { IConversation, IMessage } from "../src/interfaces.js";
import type { TextEmbeddingModel } from "@typeagent/aiclient";
import { success } from "typechat";
import { runWithSearchTiming } from "../src/searchTiming.js";
import { temporalSegments } from "../src/temporal.js";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

describe("bounded preparation and ordered isolated application", () => {
    test("2,1,0 completions apply in original order and W=4 blocks a fifth admission", async () => {
        const blocked = deferred();
        const started: number[] = [];
        const completed: number[] = [];
        const applied: number[] = [];
        const allAdmitted = deferred();
        const laterCompleted = deferred();
        const work = prepareInOrder(
            6,
            { workers: 4, window: 4 },
            async (sequence) => {
                started.push(sequence);
                if (started.length === 4) allAdmitted.resolve();
                if (sequence === 0) await blocked.promise;
                completed.push(sequence);
                if (completed.length === 3) laterCompleted.resolve();
                return sequence;
            },
            (value) => {
                applied.push(value);
            },
        );
        await allAdmitted.promise;
        await laterCompleted.promise;
        expect(started).toEqual([0, 1, 2, 3]);
        expect(applied).toEqual([]);
        blocked.resolve();
        await work;
        expect(applied).toEqual([0, 1, 2, 3, 4, 5]);
        const reverse = [deferred(), deferred(), deferred()];
        const prepared = [deferred(), deferred(), deferred()];
        const order: number[] = [];
        const ordered = prepareInOrder(
            3,
            { workers: 3, window: 3 },
            async (sequence) => {
                await reverse[sequence].promise;
                prepared[sequence].resolve();
                return sequence;
            },
            (sequence) => {
                order.push(sequence);
            },
        );
        for (const sequence of [2, 1, 0]) {
            reverse[sequence].resolve();
            await prepared[sequence].promise;
        }
        await ordered;
        expect(order).toEqual([0, 1, 2]);
    });

    test("failure/cancellation stop admission and drain providers that ignore abort", async () => {
        const blocked = deferred();
        const entered = deferred();
        const controller = new AbortController();
        let drained = false;
        let settled = false;
        const work = prepareInOrder(
            8,
            { workers: 2, window: 2, signal: controller.signal },
            async (sequence) => {
                if (sequence === 0) {
                    entered.resolve();
                    await blocked.promise;
                    drained = true;
                }
                return sequence;
            },
            () => {
                throw new Error("must not apply cancelled unit");
            },
        );
        const outcome = work.then(
            () => {
                settled = true;
            },
            (error: unknown) => {
                settled = true;
                expect(error).toBe(controller.signal.reason);
            },
        );
        await entered.promise;
        controller.abort(new Error("cancelled"));
        await Promise.resolve();
        expect(settled).toBe(false);
        blocked.resolve();
        await outcome;
        expect(drained).toBe(true);
        const admissions: number[] = [];
        await expect(
            prepareInOrder(
                8,
                { workers: 2, window: 2 },
                async (sequence) => {
                    admissions.push(sequence);
                    throw new Error("controlled failure");
                },
                () => {},
            ),
        ).rejects.toThrow("controlled failure");
        expect(admissions).toEqual([0, 1]);
    });

    test("serial/concurrent knowledge, metadata-only terms, vectors and source coordinates agree", async () => {
        let applyDepth = 0;
        let modelCallsDuringApply = 0;
        const model: TextEmbeddingModel = {
            maxBatchSize: 8,
            generateEmbedding: async () => {
                if (applyDepth) modelCallsDuringApply++;
                return success([1, 0]);
            },
            generateEmbeddingBatch: async (texts) => {
                if (applyDepth) modelCallsDuringApply++;
                return success(texts.map(() => [1, 0]));
            },
        };
        const build = async (prepared: boolean) => {
            const settings = createConversationSettings(model, 2);
            settings.semanticRefIndexSettings.knowledgeExtractor = {
                settings: { maxContextLength: 4096 },
                extract: async () => ({
                    entities: [],
                    topics: [],
                    actions: [],
                    inverseActions: [],
                }),
                extractWithRetry: async (text) => {
                    if (applyDepth) modelCallsDuringApply++;
                    return success({
                        entities: [],
                        topics: [text],
                        actions: [],
                        inverseActions: [],
                    });
                },
            };
            if (prepared) settings.preparedIndexing = { workers: 3, window: 3 };
            const messages: IMessage[] = [
                {
                    textChunks: ["first", "second"],
                    tags: ["metadata-one"],
                    getKnowledge: () => undefined,
                },
                {
                    textChunks: ["third"],
                    tags: ["metadata-two"],
                    getKnowledge: () => undefined,
                },
                {
                    textChunks: [],
                    tags: ["metadata-only"],
                    getKnowledge: () => undefined,
                },
            ];
            const refs = new SemanticRefCollection();
            const append = refs.append.bind(refs);
            refs.append = (...values) => {
                applyDepth++;
                try {
                    append(...values);
                } finally {
                    applyDepth--;
                }
            };
            const conversation: IConversation = {
                nameTag: "fixture",
                tags: [],
                messages: new MessageCollection(messages),
                semanticRefs: refs,
                semanticRefIndex: new TermToSemanticRefIndex(),
                secondaryIndexes: new ConversationSecondaryIndexes(settings),
            };
            await buildConversationIndex(conversation, settings);
            return {
                refs: refs.getAll(),
                postings: (
                    conversation.semanticRefIndex as TermToSemanticRefIndex
                ).serialize(),
                related: (
                    conversation.secondaryIndexes as ConversationSecondaryIndexes
                ).termToRelatedTermsIndex.serialize(),
                messages: (
                    conversation.secondaryIndexes as ConversationSecondaryIndexes
                ).messageIndex!.serialize(),
            };
        };
        const serial = await build(false);
        const concurrent = await build(true);
        expect(concurrent).toEqual(serial);
        expect(concurrent.related.textEmbeddingData!.textItems).toContain(
            "metadata-only",
        );
        expect(modelCallsDuringApply).toBe(0);
    });

    test("same-owner preparation preserves discoveries inherited by later messages", async () => {
        const build = async (prepared: boolean) => {
            const texts = [
                "Launch was 2024-05-01.",
                "That was the earlier event.",
            ];
            const first = temporalSegments(
                texts.join(" "),
                {
                    version: 1,
                    scopes: [
                        {
                            ownerId: "owner",
                            start: 0,
                            end: texts.join(" ").length,
                            messageTime: "2024-05-10",
                        },
                    ],
                },
                "revision",
            )[0].context!;
            first.partOrdinal = 0;
            const second = structuredClone(first);
            second.partOrdinal = 1;
            const prompts: string[] = [];
            const settings = createConversationSettings(undefined, 2);
            settings.semanticRefIndexSettings.knowledgeExtractor = {
                settings: { maxContextLength: 4096 },
                extract: async () => ({
                    entities: [],
                    topics: [],
                    actions: [],
                    inverseActions: [],
                }),
                extractWithRetry: async (text, _retries, preamble) => {
                    prompts.push(JSON.stringify(preamble));
                    return success({
                        entities: [],
                        topics: [text],
                        actions: [],
                        inverseActions: [],
                        dateAnchors: text.includes("2024-05-01")
                            ? [
                                  {
                                      quote: texts[0],
                                      date: "2024-05-01",
                                      role: "eventTime" as const,
                                  },
                              ]
                            : [],
                    });
                },
            };
            if (prepared) settings.preparedIndexing = { workers: 2, window: 2 };
            const conversation: IConversation = {
                nameTag: "temporal preparation",
                tags: [],
                messages: new MessageCollection(
                    texts.map((text, ordinal) => ({
                        textChunks: [text],
                        tags: [],
                        metadata: {
                            temporalContext: ordinal === 0 ? first : second,
                        },
                        getKnowledge: () => undefined,
                    })),
                ),
                semanticRefs: new SemanticRefCollection(),
                semanticRefIndex: new TermToSemanticRefIndex(),
                secondaryIndexes: new ConversationSecondaryIndexes(settings),
            };
            await buildConversationIndex(conversation, settings);
            expect(prompts[1]).toContain(texts[0]);
            expect(
                second.inheritedDateEvidence.some(
                    (evidence) => evidence.value.localDateTime === "2024-05-01",
                ),
            ).toBe(true);
            return {
                prompts,
                contexts: [first, second],
                refs: conversation.semanticRefs!.getAll(),
                postings: (
                    conversation.semanticRefIndex as TermToSemanticRefIndex
                ).serialize(),
            };
        };
        expect(await build(true)).toEqual(await build(false));
    });

    test("window and apply spans report only operation counts", async () => {
        const previous = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        const warning = console.warn;
        const logs: string[] = [];
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        console.warn = (line: unknown) => {
            logs.push(String(line));
        };
        try {
            await runWithSearchTiming("synthetic", "test", () =>
                prepareInOrder(
                    4,
                    { workers: 2, window: 2 },
                    async (sequence) => sequence,
                    () => {},
                ),
            );
            expect(logs.some((line) => line.includes('"highWater":2'))).toBe(
                true,
            );
            expect(
                logs.filter((line) =>
                    line.includes('"stage":"ingestion.unit.apply"'),
                ),
            ).toHaveLength(4);
        } finally {
            console.warn = warning;
            if (previous === undefined)
                delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
            else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = previous;
        }
    });
});
