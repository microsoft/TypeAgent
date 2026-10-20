// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EmbeddingIdentity } from "@typeagent/aiclient";
import {
    readConversationDataFromFile,
    readConversationDataFromBuffer,
    writeConversationDataToFile,
    PersistedEmbeddingIdentityError,
    validateConversationEmbeddingIdentities,
} from "../src/serialization.js";
import { IConversationDataWithIndexes } from "../src/secondaryIndexes.js";

const identity: EmbeddingIdentity = {
    schemaVersion: 1,
    provider: "synthetic",
    model: "fixture",
    revision: "1",
    dimensions: 2,
    task: "document",
    prompt: "",
    pooling: "mean",
    normalization: "l2",
    preprocessing: "fixture",
    artifactHash: "a".repeat(64),
};

describe("identity-aware conversation serialization", () => {
    const root = path.resolve(`serialization-test-${randomUUID()}`);
    beforeEach(async () => fs.mkdir(root, { recursive: true }));
    afterEach(async () => fs.rm(root, { recursive: true, force: true }));
    function data(): IConversationDataWithIndexes {
        return {
            nameTag: "source",
            tags: [],
            semanticRefs: [],
            messages: [{ textChunks: ["source knowledge"], tags: [] }],
            messageIndexData: {
                indexData: {
                    embeddings: [new Float32Array([1, 0])],
                    textLocations: [{ messageOrdinal: 0, chunkOrdinal: 0 }],
                },
                messageCount: 1,
            },
        };
    }
    test("identity roundtrip does not mutate caller vectors", async () => {
        const source = data();
        Object.assign(source.messages[0], { ignoredCallback: () => "legacy" });
        await writeConversationDataToFile(
            source,
            root,
            "known",
            { embeddingSize: 2 },
            { message: identity },
        );
        expect(source.messageIndexData!.indexData!.embeddings).toHaveLength(1);
        const loaded = await readConversationDataFromFile(root, "known", 2, {
            message: identity,
        });
        expect(loaded!.messageIndexData!.indexData!.embeddings[0]).toEqual(
            new Float32Array([1, 0]),
        );
    });
    test("segmented JSON retains vector identities and exact float32 data without a monolithic binary rewrite", async () => {
        const directory = path.join(root, "segmented");
        await writeConversationDataToFile(
            data(),
            directory,
            "known",
            { embeddingSize: 2 },
            { message: identity },
            true,
        );
        expect(await fs.readdir(directory)).not.toContain(
            "known_embeddings.bin",
        );
        const loaded = await readConversationDataFromFile(
            directory,
            "known",
            2,
            { message: identity },
        );
        expect(loaded!.messageIndexData!.indexData!.embeddings[0]).toEqual(
            new Float32Array([1, 0]),
        );
        await expect(
            readConversationDataFromFile(directory, "known", 2, {
                message: { ...identity, revision: "wrong" },
            }),
        ).rejects.toBeInstanceOf(PersistedEmbeddingIdentityError);
        const text = await readConversationDataFromFile(
            directory,
            "known",
            2,
            { message: identity },
            { loadEmbeddings: false },
        );
        expect(text!.messageIndexData!.indexData).toBeUndefined();
        expect(text!.messages).toEqual(data().messages);
    });
    test("strict reads reject missing vector artifact", async () => {
        await writeConversationDataToFile(
            data(),
            root,
            "missing",
            { embeddingSize: 2 },
            { message: identity },
        );
        await fs.unlink(path.join(root, "missing_embeddings.bin"));
        await expect(
            readConversationDataFromFile(root, "missing", 2, {
                message: identity,
            }),
        ).rejects.toThrow("missing or incomplete");
    });
    test.each(["legacy", "wrong"])(
        "rejects %s identity preserving structured source",
        async (kind) => {
            await writeConversationDataToFile(
                data(),
                root,
                "source",
                { embeddingSize: 2 },
                kind === "legacy" ? undefined : { message: identity },
            );
            try {
                await readConversationDataFromFile(root, "source", 2, {
                    message: { ...identity, revision: "other" },
                });
                throw new Error("Expected identity rejection");
            } catch (error) {
                expect(error).toBeInstanceOf(PersistedEmbeddingIdentityError);
                const source = (error as PersistedEmbeddingIdentityError)
                    .conversationData;
                expect(source.messages[0].textChunks).toEqual([
                    "source knowledge",
                ]);
                expect(source.messageIndexData!.indexData).toBeUndefined();
            }
            // Existing callers retain dimension-only legacy compatibility.
            expect(
                (await readConversationDataFromFile(root, "source", 2))!
                    .messageIndexData!.indexData!.embeddings,
            ).toHaveLength(1);
        },
    );

    test.each(["known", "legacy"] as const)(
        "explicit text-only file and buffer reads discard %s vectors without a binary artifact",
        async (kind) => {
            const source = {
                ...data(),
                threadData: {
                    threads: [
                        {
                            thread: {
                                description: "retained discussion",
                                ranges: [],
                            },
                            embedding: [1, 0],
                        },
                    ],
                },
            };
            await writeConversationDataToFile(
                source,
                root,
                "text-only",
                { embeddingSize: 2 },
                kind === "known" ? { message: identity } : undefined,
            );
            const filename = path.join(root, "text-only_data.json");
            const json = await fs.readFile(filename, "utf8");
            await fs.unlink(path.join(root, "text-only_embeddings.bin"));
            const loaded = [
                await readConversationDataFromFile(
                    root,
                    "text-only",
                    3,
                    { message: { ...identity, dimensions: 3 } },
                    { loadEmbeddings: false },
                ),
                await readConversationDataFromBuffer(
                    json,
                    Buffer.alloc(0),
                    3,
                    {},
                    { loadEmbeddings: false },
                ),
            ];
            for (const result of loaded) {
                expect(result?.messages[0].textChunks).toEqual([
                    "source knowledge",
                ]);
                expect(result?.messageIndexData?.indexData).toBeUndefined();
                expect(result?.threadData?.threads?.[0]).toEqual({
                    thread: { description: "retained discussion", ranges: [] },
                    embedding: [],
                });
            }
            expect(await fs.readFile(filename, "utf8")).toBe(json);
        },
    );

    test("automatic identities on serialized blobs are retained by the file writer", async () => {
        await writeConversationDataToFile(
            { ...data(), embeddingIdentities: { message: identity } },
            root,
            "automatic",
        );
        expect(
            (
                await readConversationDataFromFile(root, "automatic", 2, {
                    message: identity,
                })
            )?.messageIndexData?.indexData?.embeddings,
        ).toHaveLength(1);
    });

    test("unknown current models cannot load known or legacy vector spaces", async () => {
        await writeConversationDataToFile(data(), root, "unknown", undefined, {
            message: identity,
        });
        await expect(
            readConversationDataFromFile(root, "unknown", 2, {}),
        ).rejects.toThrow(PersistedEmbeddingIdentityError);
    });

    test("strict buffer reads reject incompatible models while retaining source and inline thread descriptions", async () => {
        const source = {
            ...data(),
            threadData: {
                threads: [
                    {
                        thread: {
                            description: "retained discussion",
                            ranges: [],
                        },
                        embedding: [1, 0],
                    },
                ],
            },
        };
        await writeConversationDataToFile(source, root, "buffer", undefined, {
            message: identity,
        });
        const json = await fs.readFile(
            path.join(root, "buffer_data.json"),
            "utf8",
        );
        const binary = await fs.readFile(
            path.join(root, "buffer_embeddings.bin"),
        );
        try {
            await readConversationDataFromBuffer(json, binary, 3, {
                message: { ...identity, dimensions: 3 },
            });
            throw new Error("Expected incompatible embedding identity");
        } catch (error) {
            expect(error).toBeInstanceOf(PersistedEmbeddingIdentityError);
            const retained = (error as PersistedEmbeddingIdentityError)
                .conversationData;
            expect(retained.messages[0].textChunks).toEqual([
                "source knowledge",
            ]);
            expect(retained.threadData?.threads?.[0].thread.description).toBe(
                "retained discussion",
            );
            expect(retained.threadData?.threads?.[0].embedding).toEqual([]);
        }
    });

    test.each([
        "model",
        "revision",
        "prompt",
        "preprocessing",
        "artifactHash",
    ] as const)(
        "same-size incompatible %s rejects direct blobs without mutating caller indexes",
        (field) => {
            const original = {
                ...data(),
                embeddingIdentities: {
                    message: {
                        ...identity,
                        [field]:
                            field === "artifactHash"
                                ? "b".repeat(64)
                                : "different",
                    },
                },
            };
            expect(() =>
                validateConversationEmbeddingIdentities(
                    original,
                    { message: identity },
                    2,
                ),
            ).toThrow(PersistedEmbeddingIdentityError);
            expect(
                original.messageIndexData?.indexData?.embeddings,
            ).toHaveLength(1);
        },
    );

    test("malformed stored identities produce the actionable mismatch error with retained source", () => {
        const original = {
            ...data(),
            embeddingIdentities: {
                message: { ...identity, artifactHash: "unknown" },
            },
        };
        expect(() =>
            validateConversationEmbeddingIdentities(
                original,
                { message: identity },
                2,
            ),
        ).toThrow(PersistedEmbeddingIdentityError);
    });

    test("source-only memories without vectors do not require fabricated identities", async () => {
        const source = data();
        delete source.messageIndexData;
        await writeConversationDataToFile(source, root, "source-only");
        const loaded = await readConversationDataFromFile(
            root,
            "source-only",
            2,
            {},
        );
        expect(loaded?.messages[0].textChunks).toEqual(["source knowledge"]);
    });
});
