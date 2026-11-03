// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "@typeagent/knowpro";
import type { TextEmbeddingModel } from "@typeagent/aiclient";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../src/sqlite/sqliteCommon.js";
import {
    SqlMessageCollection,
    SqlSemanticRefCollection,
    SqliteStorageProvider,
} from "../src/sqlite/sqliteProvider.js";
import {
    SqlitePreparedIndexStorage,
    type PreparedIndexCheckpoint,
} from "../src/sqlite/sqlitePreparedIndex.js";

const success = <T>(data: T) => ({ success: true as const, data });

describe("persistent ordered prepared indexing", () => {
    let root: string;
    let db: ReturnType<typeof createDatabase>;
    let conversation: kp.IConversation;
    let settings: kp.ConversationSettings;
    let storage: SqlitePreparedIndexStorage;
    let fault: Parameters<PreparedIndexCheckpoint>[0] | undefined;
    let forbidden: boolean;
    let calls: number;
    let entered: (() => void) | undefined;
    let blocked: Promise<void> | undefined;

    const serializer: kp.JsonSerializer<kp.IMessage> = {
        serialize: JSON.stringify,
        deserialize: (text) => ({
            ...JSON.parse(text),
            getKnowledge: () => undefined,
        }),
    };
    const message = (text: string): kp.IMessage => ({
        textChunks: text ? [text] : [],
        tags: ["metadata-term"],
        getKnowledge: () => undefined,
    });

    function open() {
        db = createDatabase(path.join(root, "memory.db"), false);
        const messages = new SqlMessageCollection(db, serializer);
        const refs = new SqlSemanticRefCollection(db);
        storage = new SqlitePreparedIndexStorage(
            db,
            messages,
            refs,
            (point) => {
                expect(db.inTransaction).toBe(true);
                if (fault === point) throw new Error(`injected ${point}`);
            },
        );
        const provider: kp.IStorageProvider = {
            createMessageCollection: <T extends kp.IMessage>(
                codec?: kp.JsonSerializer<T>,
            ) => new SqlMessageCollection<T>(db, codec),
            createSemanticRefCollection: () => refs,
            createPreparedIndexStorage: () => storage,
            close: () => db.close(),
        };
        conversation = {
            nameTag: "synthetic",
            tags: [],
            messages,
            semanticRefs: refs,
            storageProvider: provider,
            semanticRefIndex: new kp.TermToSemanticRefIndex(),
            secondaryIndexes: new kp.ConversationSecondaryIndexes(settings),
        };
    }

    beforeEach(() => {
        root = mkdtempSync(path.join(os.tmpdir(), "prepared-index-"));
        fault = undefined;
        forbidden = false;
        calls = 0;
        blocked = undefined;
        entered = undefined;
        const check = () => {
            expect(db.inTransaction).toBe(false);
            if (forbidden) throw new Error("Unexpected model work");
            calls++;
        };
        const model: TextEmbeddingModel = {
            maxBatchSize: 16,
            forRole: (role) => ({
                ...model,
                embeddingIdentity: { ...model.embeddingIdentity!, task: role },
            }),
            embeddingIdentity: {
                schemaVersion: 1,
                provider: "offline",
                model: "fixture",
                revision: "1",
                dimensions: 2,
                task: "document",
                prompt: "fixture",
                pooling: "mean",
                normalization: "l2",
                preprocessing: "fixture",
                artifactHash: "a".repeat(64),
            },
            generateEmbedding: async () => {
                check();
                return success([1, 0]);
            },
            generateEmbeddingBatch: async (texts) => {
                check();
                return success(texts.map(() => [1, 0]));
            },
        };
        settings = kp.createConversationSettings(model, 2);
        settings.preparedIndexing = { workers: 3, window: 3 };
        settings.semanticRefIndexSettings.knowledgeExtractor = {
            settings: { maxContextLength: 4096 },
            extract: async () => ({
                entities: [],
                topics: [],
                actions: [],
                inverseActions: [],
            }),
            extractWithRetry: async (text) => {
                check();
                entered?.();
                await blocked;
                return success({
                    entities: [],
                    topics: [text],
                    actions: [],
                    inverseActions: [],
                });
            },
        };
        open();
        conversation.messages.append(
            message("first"),
            message("second"),
            message(""),
        );
    });
    afterEach(() => {
        db.close();
        rmSync(root, { recursive: true, force: true });
    });

    function state() {
        return {
            refs: conversation.semanticRefs!.getAll(),
            terms: (
                conversation.semanticRefIndex as kp.TermToSemanticRefIndex
            ).serialize(),
            related: (
                conversation.secondaryIndexes as kp.ConversationSecondaryIndexes
            ).termToRelatedTermsIndex.serialize(),
            messages: (
                conversation.secondaryIndexes as kp.ConversationSecondaryIndexes
            ).messageIndex!.serialize(),
        };
    }

    test("commits knowledge, metadata, postings, vectors and receipt; reload and replay need no model calls", async () => {
        await kp.buildConversationIndex(conversation, settings);
        const expected = state();
        expect(storage.capture().data!.indexedMessageCount).toBe(3);
        expect(expected.related.textEmbeddingData!.textItems).toContain(
            "metadata-term",
        );
        const before = calls;
        db.close();
        open();
        forbidden = true;
        expect(
            await kp.restorePreparedConversationIndex(conversation, settings),
        ).toBe(3);
        expect(state()).toEqual(expected);
        await kp.addToConversationIndex(conversation, settings, 0, 0);
        expect(state()).toEqual(expected);
        expect(calls).toBe(before);
    });

    test.each(["rows", "postings", "receipt"] as const)(
        "failure at %s rolls back rows, metadata, artifacts and all mirrors before same-provider retry",
        async (point) => {
            const original = state();
            fault = point;
            await expect(
                kp.buildConversationIndex(conversation, settings),
            ).rejects.toThrow(`injected ${point}`);
            expect(state()).toEqual(original);
            expect(storage.capture().data).toBeUndefined();
            expect(
                db
                    .prepare("SELECT COUNT(*) AS n FROM semanticRefsMetadata")
                    .get(),
            ).toEqual({ n: 0 });
            fault = undefined;
            await kp.buildConversationIndex(conversation, settings);
            expect(
                conversation
                    .semanticRefs!.getAll()
                    .map((ref) => ref.semanticRefOrdinal),
            ).toEqual(
                Array.from(
                    { length: conversation.semanticRefs!.length },
                    (_, i) => i,
                ),
            );
            expect(storage.capture().data).toBeDefined();
        },
    );

    test("incremental acceptance preserves old properties, term vectors and source coordinates", async () => {
        await kp.buildConversationIndex(conversation, settings);
        const previous = state();
        const base = conversation.semanticRefs!.length;
        conversation.messages.append(message("third"));
        await kp.addToConversationIndex(conversation, settings, 3, base);
        expect(conversation.semanticRefs!.getSlice(0, base)).toEqual(
            previous.refs,
        );
        expect(storage.capture().data!.indexedMessageCount).toBe(4);
        expect(
            (await kp.searchConversationKnowledge(
                conversation,
                {
                    booleanOp: "or",
                    terms: [
                        {
                            propertyName: "topic",
                            propertyValue: { term: { text: "first" } },
                        },
                    ],
                },
                undefined,
                { exactMatch: true },
            ))!.get("topic")!.semanticRefMatches,
        ).toHaveLength(1);
        expect(
            state().related.textEmbeddingData!.textItems.filter(
                (text) => text === "metadata-term",
            ),
        ).toHaveLength(1);
    });

    test("a source append during preparation rejects the stale candidate without deleting new input", async () => {
        let release!: () => void;
        blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const ready = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const work = kp.buildConversationIndex(conversation, settings);
        await Promise.race([ready, work]);
        conversation.messages.append(message("new input"));
        release();
        await expect(work).rejects.toThrow("snapshot is stale");
        expect(conversation.messages.length).toBe(4);
        expect(conversation.semanticRefs!.length).toBe(0);
        blocked = undefined;
        await kp.buildConversationIndex(conversation, settings);
        expect(storage.capture().data!.indexedMessageCount).toBe(4);
    });

    test("cancel drains providers ignoring abort without publishing partial rows", async () => {
        let release!: () => void;
        blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const ready = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const controller = new AbortController();
        settings.preparedIndexing!.signal = controller.signal;
        let settled = false;
        const work = kp.buildConversationIndex(conversation, settings);
        const outcome = work.then(
            () => {
                settled = true;
            },
            (error: unknown) => {
                settled = true;
                expect(error).toBe(controller.signal.reason);
            },
        );
        await Promise.race([ready, work]);
        controller.abort(new Error("cancelled"));
        await Promise.resolve();
        expect(settled).toBe(false);
        release();
        await outcome;
        expect(conversation.semanticRefs!.length).toBe(0);
        expect(storage.capture().data).toBeUndefined();
    });

    test("source replacement invalidates retained artifacts; explicit rebuild recovers", async () => {
        await kp.buildConversationIndex(conversation, settings);
        db.prepare("UPDATE messages SET value=? WHERE ordinal=1").run(
            serializer.serialize(message("replacement")),
        );
        await expect(
            kp.restorePreparedConversationIndex(conversation, settings),
        ).rejects.toThrow("source revision changed");
        await kp.buildConversationIndex(conversation, settings);
        expect(
            (
                conversation.semanticRefIndex as kp.TermToSemanticRefIndex
            ).lookupTerm("first"),
        ).toHaveLength(0);
        expect(
            conversation.semanticRefIndex!.lookupTerm("replacement"),
        ).toHaveLength(1);
    });

    test("commit duration and bounded preparation diagnostics contain counts, not source text", async () => {
        const trace = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        const warn = console.warn;
        const logs: string[] = [];
        console.warn = (...args: unknown[]) => {
            logs.push(String(args[0]));
        };
        try {
            process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
            await kp.runWithSearchTiming(undefined, "prepared-fixture", () =>
                kp.buildConversationIndex(conversation, settings),
            );
            const line = logs.find((line) =>
                line.includes('"stage":"ingestion.sqlite.commit"'),
            );
            expect(line).toBeDefined();
            const event = JSON.parse(
                line!.replace("[memory-search-timing] ", ""),
            );
            expect(event.metadata).toEqual({
                messageCount: 3,
                semanticRefCount: conversation.semanticRefs!.length,
            });
            expect(event.elapsedMs).toBeGreaterThanOrEqual(0);
            expect(logs.some((line) => line.includes('"highWater":3'))).toBe(
                true,
            );
            expect(logs.join("\n")).not.toContain("metadata-term");
        } finally {
            console.warn = warn;
            if (trace === undefined)
                delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
            else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = trace;
        }
    });

    test("serial and concurrent persistent preparation publish identical postings, vectors and coordinates", async () => {
        await kp.buildConversationIndex(conversation, settings);
        const concurrent = state();
        settings.preparedIndexing = { workers: 1, window: 1 };
        await kp.buildConversationIndex(conversation, settings);
        expect(state()).toEqual(concurrent);
    });

    test("restore rejects a source change during awaited model resolution without swapping mirrors", async () => {
        await kp.buildConversationIndex(conversation, settings);
        const previous = state();
        const lane = settings.messageTextIndexSettings.embeddingIndexSettings;
        const model = lane.embeddingModel!;
        lane.embeddingModel = {
            ...model,
            resolve: async () => {
                conversation.messages.append(message("concurrent"));
                return model;
            },
        };
        await expect(
            kp.restorePreparedConversationIndex(conversation, settings),
        ).rejects.toThrow("snapshot changed");
        expect(state()).toEqual(previous);
    });

    test("unknown vector identities fail before extraction or vector preparation", async () => {
        for (const lane of [
            settings.relatedTermIndexSettings.embeddingIndexSettings!,
            settings.messageTextIndexSettings.embeddingIndexSettings,
            settings.threadSettings,
        ]) {
            lane.embeddingModel = {
                maxBatchSize: 16,
                generateEmbedding: async () => {
                    calls++;
                    return success([1, 0]);
                },
            };
        }
        await expect(
            kp.buildConversationIndex(conversation, settings),
        ).rejects.toThrow("known embedding identities");
        expect(calls).toBe(0);
        expect(conversation.semanticRefs!.length).toBe(0);
    });

    test("receipts reject future versions and caller-owned transactions", async () => {
        await kp.buildConversationIndex(conversation, settings);
        const snapshot = storage.capture();
        db.transaction(() => {
            expect(() =>
                storage.commit(snapshot.stamp, {
                    messages: conversation.messages.getAll(),
                    semanticRefs: conversation.semanticRefs!.getAll(),
                    data: snapshot.data!,
                }),
            ).toThrow("must own");
        })();
        db.exec("UPDATE semanticRefsPreparedIndex SET version=999");
        expect(() => storage.capture()).toThrow("Unsupported");
        await expect(
            kp.buildConversationIndex(conversation, settings),
        ).rejects.toThrow("Unsupported");
    });

    test("production provider capability rejects collections from other connections", () => {
        const provider = new SqliteStorageProvider(
            path.join(root, "provider.db"),
            true,
        );
        try {
            const messages = provider.createMessageCollection(serializer);
            const refs = provider.createSemanticRefCollection();
            expect(
                provider.createPreparedIndexStorage(messages, refs).capture()
                    .data,
            ).toBeUndefined();
            expect(() =>
                provider.createPreparedIndexStorage(
                    conversation.messages,
                    refs,
                ),
            ).toThrow("belong");
            expect(() =>
                provider.createPreparedIndexStorage(
                    messages,
                    conversation.semanticRefs!,
                ),
            ).toThrow("belong");
        } finally {
            provider.close();
        }
    });
});
