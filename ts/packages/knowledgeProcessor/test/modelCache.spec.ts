// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    EmbeddingIdentity,
    EmbeddingRole,
    EmbeddingPart,
    ResolvedCandidateEmbeddingModel,
    createCandidateEmbeddingModel,
    TextEmbeddingModel,
} from "@typeagent/aiclient";
import { error, success } from "typechat";
import {
    createEmbeddingCache,
    createTextEmbeddingModelWithCache,
    embeddingCacheKey,
    mediaEmbeddingCacheKey,
} from "../src/modelCache.js";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

function identity(role: EmbeddingRole, revision = "one"): EmbeddingIdentity {
    return {
        schemaVersion: 1,
        provider: "local",
        model: "synthetic",
        revision,
        dimensions: 2,
        task: role,
        prompt: role,
        pooling: "mean",
        normalization: "l2",
        preprocessing: "text",
        artifactHash: "a".repeat(64),
    };
}

function imagePart(values = [1]): Extract<EmbeddingPart, { type: "image" }> {
    const bytes = new Uint8Array(values);
    return {
        type: "image",
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mimeType: "image/png",
    };
}

describe("identity-aware embedding caches", () => {
    let calls: string[];
    let malformed: number[][] | undefined;
    let fail: boolean;
    function model(
        role: EmbeddingRole = "document",
        revision = "one",
    ): TextEmbeddingModel {
        return {
            maxBatchSize: 8,
            embeddingIdentity: identity(role, revision),
            forRole: (next) => model(next, revision),
            async generateEmbedding(text) {
                calls.push(`${role}:${text}`);
                return fail
                    ? error("offline failure")
                    : success(
                          malformed?.[0] ??
                              (role === "query" ? [0, 1] : [1, 0]),
                      );
            },
            async generateEmbeddingBatch(texts) {
                calls.push(`${role}:${texts.join(",")}`);
                return fail
                    ? error("offline failure")
                    : success(
                          malformed ??
                              texts.map(() =>
                                  role === "query" ? [0, 1] : [1, 0],
                              ),
                      );
            },
        };
    }
    beforeEach(() => {
        calls = [];
        malformed = undefined;
        fail = false;
    });

    test("memory and persistent caches isolate role and revision; wrappers preserve identity", async () => {
        const persistent = new Map<string, number[]>();
        const cache = {
            getEmbedding: (key: string) => persistent.get(key),
            putEmbedding: (key: string, value: number[]) => {
                persistent.set(key, value);
            },
        };
        const wrapped = createEmbeddingCache(model(), 8, () => cache);
        const query = wrapped.forRole!("query");
        expect(wrapped.forRole!("query")).toBe(query);
        expect(wrapped.embeddingIdentity).toEqual(identity("document"));
        expect(query.embeddingIdentity).toEqual(identity("query"));
        await wrapped.generateEmbedding("same");
        await wrapped.generateEmbedding("same");
        expect(await query.generateEmbedding("same")).toEqual(success([0, 1]));
        await createEmbeddingCache(
            model("document", "two"),
            8,
            () => cache,
        ).generateEmbedding("same");
        expect(calls).toEqual(["document:same", "query:same", "document:same"]);
        expect(persistent.size).toBe(3);
        expect(
            wrapped.cache.has(embeddingCacheKey("same", identity("document"))),
        ).toBe(true);
        expect(persistent.has("same")).toBe(false);
    });

    test.each(
        [
            [],
            [[1, 0]],
            [
                [1, 0],
                [1, 0],
                [1, 0],
            ],
            [
                [1, 0],
                [NaN, 0],
            ],
            [
                [1, 0],
                [0, 0],
            ],
            [[1, 0], [1]],
        ].map((batch) => [batch]),
    )("malformed batch fails atomically: %j", async (batch) => {
        malformed = batch;
        const wrapped = createEmbeddingCache(model(), 8);
        expect(
            (await wrapped.generateEmbeddingBatch!(["a", "b"])).success,
        ).toBe(false);
        expect(wrapped.cache.size).toBe(0);
    });

    test("mixed hits preserve ordering; failures and invalid singles are not cached", async () => {
        const wrapped = createEmbeddingCache(model(), 8);
        await wrapped.generateEmbedding("hit");
        expect(
            await wrapped.generateEmbeddingBatch!(["miss", "hit", "other"]),
        ).toEqual(
            success([
                [1, 0],
                [1, 0],
                [1, 0],
            ]),
        );
        expect(calls).toEqual(["document:hit", "document:miss,other"]);
        fail = true;
        await wrapped.generateEmbedding("failed");
        expect(wrapped.cache.size).toBe(3);
        fail = false;
        malformed = [[Infinity, 0]];
        expect((await wrapped.generateEmbedding("invalid")).success).toBe(
            false,
        );
        expect(wrapped.cache.size).toBe(3);
        expect((await wrapped.generateEmbeddingBatch!([])).success).toBe(false);
    });

    test("legacy caches keep raw keys and accept legacy unnormalized finite vectors", async () => {
        const legacy: TextEmbeddingModel = {
            maxBatchSize: 1,
            async generateEmbedding() {
                calls.push("legacy");
                return success([3, 4]);
            },
        };
        const values = new Map<string, number[]>();
        const wrapped = createTextEmbeddingModelWithCache(legacy, {
            getEmbedding: (text) => values.get(text),
            putEmbedding: (text, vector) => {
                values.set(text, vector);
            },
        });
        await wrapped.generateEmbedding("raw");
        await wrapped.generateEmbedding("raw");
        expect(values.get("raw")).toEqual([3, 4]);
        expect(calls).toEqual(["legacy"]);
    });

    test("invalid cache hits are ignored and disabling cache prevents all writes", async () => {
        const wrapped = createEmbeddingCache(model(), 8);
        wrapped.cache.put(
            embeddingCacheKey("bad", identity("document")),
            [0, 0],
        );
        expect(await wrapped.generateEmbedding("bad")).toEqual(success([1, 0]));
        wrapped.cacheEnabled = false;
        await wrapped.generateEmbedding("uncached");
        expect(wrapped.cache.size).toBe(1);
    });

    test("unresolved role-aware models never read the legacy cache namespace", async () => {
        let resolved = false;
        const inner: TextEmbeddingModel = {
            maxBatchSize: 1,
            get embeddingIdentity() {
                return resolved ? identity("document") : undefined;
            },
            forRole() {
                return inner;
            },
            async generateEmbedding() {
                resolved = true;
                calls.push("resolved");
                return success([1, 0]);
            },
        };
        const values = new Map<string, number[]>([["same", [0, 1]]]);
        const wrapped = createTextEmbeddingModelWithCache(inner, {
            getEmbedding: (key) => values.get(key),
            putEmbedding: (key, vector) => {
                values.set(key, vector);
            },
        });
        expect(await wrapped.generateEmbedding("same")).toEqual(
            success([1, 0]),
        );
        expect(wrapped.embeddingIdentity).toEqual(identity("document"));
        expect(
            values.get(embeddingCacheKey("same", identity("document"))),
        ).toEqual([1, 0]);
        expect(calls).toEqual(["resolved"]);
    });

    test.each(["persistent", "memory"] as const)(
        "%s wrapper preserves role/descriptor/lifecycle capabilities and caches ordered media",
        async (kind) => {
            const values = new Map<string, number[]>();
            const persistent = {
                getEmbedding: (key: string) => values.get(key),
                putEmbedding: (key: string, vector: number[]) => {
                    values.set(key, vector);
                },
            };
            const descriptor = {
                provider: "local",
                model: "synthetic",
                revision: "one",
                dimensions: 2,
                query_prompt: "query",
                document_prompt: "document",
                pooling: "mean",
                normalization: "l2" as const,
                preprocessing: "text",
                artifact_sha256: "a".repeat(64),
            };
            const artifacts = [
                { path: "synthetic.onnx", sha256: "a".repeat(64) },
            ];
            const metadata = { runtime: "synthetic" };
            const mediaCalls: Array<{
                samples: EmbeddingPart[][];
                role: EmbeddingRole;
            }> = [];
            let disposals = 0;
            function mediaModel(
                role: EmbeddingRole = "document",
            ): ResolvedCandidateEmbeddingModel {
                const instance: ResolvedCandidateEmbeddingModel = {
                    ...model(role),
                    embeddingIdentity: identity(role),
                    descriptor,
                    artifacts,
                    metadata,
                    forRole: mediaModel,
                    async resolve() {
                        return instance;
                    },
                    async generateMediaEmbeddingBatch(samples) {
                        mediaCalls.push({ samples, role });
                        return success(
                            samples.map(() =>
                                role === "query" ? [0, 1] : [1, 0],
                            ),
                        );
                    },
                    async dispose() {
                        ++disposals;
                    },
                };
                return instance;
            }
            const original = mediaModel();
            const wrapped =
                kind === "memory"
                    ? createEmbeddingCache(original, 8, () => persistent)
                    : createTextEmbeddingModelWithCache(original, persistent);
            expect(wrapped.descriptor).toBe(descriptor);
            expect(wrapped.artifacts).toBe(artifacts);
            expect(wrapped.metadata).toBe(metadata);
            expect("generateMediaEmbeddingBatch" in wrapped).toBe(true);
            expect(await wrapped.resolve()).toBe(wrapped);
            const text: EmbeddingPart = { type: "text", text: "caption" };
            const image = imagePart();
            const samples = [
                [text, image],
                [image, text],
            ];
            await wrapped.generateMediaEmbeddingBatch(samples);
            await wrapped.generateMediaEmbeddingBatch(samples);
            expect(values.size).toBe(2);
            await wrapped.generateEmbedding("caption");
            await wrapped.generateEmbedding("caption");
            expect(values.size).toBe(3);
            expect(calls).toEqual(["document:caption"]);
            const query = wrapped.forRole("query");
            expect(query.descriptor).toBe(descriptor);
            expect(query.embeddingIdentity.task).toBe("query");
            expect(await query.generateMediaEmbeddingBatch(samples)).toEqual(
                success([
                    [0, 1],
                    [0, 1],
                ]),
            );
            await query.generateEmbedding("caption");
            await query.generateEmbedding("caption");
            expect(values.size).toBe(6);
            expect(calls).toEqual(["document:caption", "query:caption"]);
            expect(mediaCalls).toEqual([
                { samples, role: "document" },
                { samples, role: "query" },
            ]);
            if (kind === "memory")
                expect(wrapped.forRole("document")).toBe(wrapped);
            await query.dispose();
            expect(disposals).toBe(1);
        },
    );

    test("resolved factory media dispatch survives the memory-cache bridge and caches media", async () => {
        const candidate = await createCandidateEmbeddingModel({
            adapterPath: fileURLToPath(
                new URL(
                    "../../../aiclient/test/fixtures/candidateAdapter.mjs",
                    import.meta.url,
                ),
            ),
            runtimeDir: "synthetic",
            cacheDir: "synthetic",
            revision: "synthetic-pinned",
        });
        const wrapped = createEmbeddingCache(candidate, 8);
        try {
            expect(wrapped.descriptor).toBe(candidate.descriptor);
            expect(await wrapped.resolve()).toBe(wrapped);
            const samples: EmbeddingPart[][] = [
                [{ type: "text", text: "media" }],
            ];
            expect(await wrapped.generateMediaEmbeddingBatch(samples)).toEqual(
                success([[1, 0]]),
            );
            expect(wrapped.cache.size).toBe(1);
            expect(await wrapped.generateEmbedding("text")).toEqual(
                success([1, 0]),
            );
            expect(wrapped.cache.size).toBe(2);
        } finally {
            await wrapped.dispose();
        }
    });

    test("canonical media keys bind content, ordered parts, grouping, MIME, role and revision", () => {
        const text: EmbeddingPart = { type: "text", text: "caption" };
        const image = imagePart();
        const key = mediaEmbeddingCacheKey([text, image], identity("document"));
        expect(key).toMatch(/^media:v1:[a-f0-9]{64}$/);
        expect(
            mediaEmbeddingCacheKey([text, imagePart()], identity("document")),
        ).toBe(key);
        const variants = [
            mediaEmbeddingCacheKey([image, text], identity("document")),
            mediaEmbeddingCacheKey(
                [{ ...text, text: "changed" }, image],
                identity("document"),
            ),
            mediaEmbeddingCacheKey(
                [{ ...text, text: "caption " }, image],
                identity("document"),
            ),
            mediaEmbeddingCacheKey(
                [text, imagePart([2])],
                identity("document"),
            ),
            mediaEmbeddingCacheKey(
                [text, { ...image, mimeType: "image/jpeg" }],
                identity("document"),
            ),
            mediaEmbeddingCacheKey([text, image], identity("query")),
            mediaEmbeddingCacheKey([text, image], identity("document", "two")),
            mediaEmbeddingCacheKey([text, image], {
                ...identity("document"),
                model: "other",
            }),
            mediaEmbeddingCacheKey(
                [
                    { type: "text", text: "cap" },
                    { type: "text", text: "tion" },
                    image,
                ],
                identity("document"),
            ),
        ];
        expect(variants.every((other) => other !== key)).toBe(true);
        expect(() =>
            mediaEmbeddingCacheKey(
                [{ ...image, sha256: "b".repeat(64) }],
                identity("document"),
            ),
        ).toThrow(/digest/);
        expect(() =>
            mediaEmbeddingCacheKey([], identity("document")),
        ).toThrow();
    });

    test("media mixed hits preserve batch order and sample grouping through the existing caches", async () => {
        const values = new Map<string, number[]>();
        const batches: EmbeddingPart[][][] = [];
        const source = {
            ...model(),
            async generateMediaEmbeddingBatch(samples: EmbeddingPart[][]) {
                batches.push(samples);
                return success(
                    samples.map((parts) =>
                        parts[0].type === "text" && parts[0].text === "x"
                            ? [1, 0]
                            : [0, 1],
                    ),
                );
            },
        };
        const wrapped = createEmbeddingCache(source, 8, () => ({
            getEmbedding: (key: string) => values.get(key),
            putEmbedding: (key: string, vector: number[]) => {
                values.set(key, vector);
            },
        }));
        const x: EmbeddingPart = { type: "text", text: "x" };
        const y: EmbeddingPart = { type: "text", text: "y" };
        const image = imagePart();
        expect(
            await wrapped.generateMediaEmbeddingBatch([
                [x, image],
                [image, x],
            ]),
        ).toEqual(
            success([
                [1, 0],
                [0, 1],
            ]),
        );
        expect(
            await wrapped.generateMediaEmbeddingBatch([
                [imagePart(), x],
                [y, image],
                [x, imagePart()],
            ]),
        ).toEqual(
            success([
                [0, 1],
                [0, 1],
                [1, 0],
            ]),
        );
        expect(batches[1]).toEqual([[y, image]]);
        expect(
            await wrapped.generateMediaEmbeddingBatch([[x], [image]]),
        ).toEqual(
            success([
                [1, 0],
                [0, 1],
            ]),
        );
        expect(wrapped.cache.size).toBe(5);
        expect(values.size).toBe(5);
    });

    test.each(
        [
            [],
            [[1, 0]],
            [
                [1, 0],
                [1, 0],
                [1, 0],
            ],
            [
                [1, 0],
                [NaN, 0],
            ],
            [
                [1, 0],
                [0, 0],
            ],
            [[1, 0], [1]],
        ].map((batch) => [batch]),
    )(
        "invalid media output cannot partially mutate either cache: %j",
        async (batch) => {
            const values = new Map<string, number[]>();
            let output = [[1, 0]];
            let mediaCalls = 0;
            const source = {
                ...model(),
                async generateMediaEmbeddingBatch(_samples: EmbeddingPart[][]) {
                    ++mediaCalls;
                    return success(output);
                },
            };
            const wrapped = createEmbeddingCache(source, 8, () => ({
                getEmbedding: (key: string) => values.get(key),
                putEmbedding: (key: string, vector: number[]) => {
                    values.set(key, vector);
                },
            }));
            const hit = [imagePart()];
            expect(
                (await wrapped.generateMediaEmbeddingBatch([hit])).success,
            ).toBe(true);
            output = batch;
            expect(
                (
                    await wrapped.generateMediaEmbeddingBatch([
                        hit,
                        [imagePart([2])],
                        [imagePart([3])],
                    ])
                ).success,
            ).toBe(false);
            expect(wrapped.cache.size).toBe(1);
            expect(values.size).toBe(1);
            const invalid = { ...imagePart(), sha256: "b".repeat(64) };
            expect(
                (await wrapped.generateMediaEmbeddingBatch([[invalid]]))
                    .success,
            ).toBe(false);
            expect(mediaCalls).toBe(2);
            expect(values.size).toBe(1);
        },
    );

    test("media failures and missing identities are never cached; later success retries", async () => {
        let attempts = 0;
        let mode: "error" | "throw" | "success" = "error";
        const source = {
            ...model(),
            async generateMediaEmbeddingBatch(samples: EmbeddingPart[][]) {
                ++attempts;
                if (mode === "throw") throw new Error("synthetic failure");
                return mode === "error"
                    ? error("synthetic failure")
                    : success(samples.map(() => [1, 0]));
            },
        };
        const wrapped = createEmbeddingCache(source, 8);
        const samples = [[imagePart()]];
        expect(
            (await wrapped.generateMediaEmbeddingBatch(samples)).success,
        ).toBe(false);
        mode = "throw";
        expect(
            (await wrapped.generateMediaEmbeddingBatch(samples)).success,
        ).toBe(false);
        expect(wrapped.cache.size).toBe(0);
        mode = "success";
        expect(
            (await wrapped.generateMediaEmbeddingBatch(samples)).success,
        ).toBe(true);
        expect(
            (await wrapped.generateMediaEmbeddingBatch([[imagePart()]]))
                .success,
        ).toBe(true);
        expect(attempts).toBe(3);
        expect(wrapped.cache.size).toBe(1);
        const {
            embeddingIdentity: _identity,
            forRole: _forRole,
            ...withoutIdentity
        } = source;
        const unidentified = createEmbeddingCache(withoutIdentity, 8);
        expect(
            (await unidentified.generateMediaEmbeddingBatch(samples)).success,
        ).toBe(false);
        expect(unidentified.cache.size).toBe(0);
        expect(attempts).toBe(3);
    });

    test("media cache refuses an identity change during generation", async () => {
        let current = identity("document");
        const source = {
            ...model(),
            get embeddingIdentity() {
                return current;
            },
            async generateMediaEmbeddingBatch(_samples: EmbeddingPart[][]) {
                current = identity("document", "changed");
                return success([[1, 0]]);
            },
        };
        const wrapped = createEmbeddingCache(source, 8);
        expect(
            (await wrapped.generateMediaEmbeddingBatch([[imagePart()]]))
                .success,
        ).toBe(false);
        expect(wrapped.cache.size).toBe(0);
    });

    test("persistent media caches isolate same-sized revisions", async () => {
        const values = new Map<string, number[]>();
        let attempts = 0;
        const persistent = {
            getEmbedding: (key: string) => values.get(key),
            putEmbedding: (key: string, vector: number[]) => {
                values.set(key, vector);
            },
        };
        function revisionModel(revision: string) {
            return createEmbeddingCache(
                {
                    ...model("document", revision),
                    async generateMediaEmbeddingBatch(
                        samples: EmbeddingPart[][],
                    ) {
                        ++attempts;
                        return success(
                            samples.map(() =>
                                revision === "one" ? [1, 0] : [0, 1],
                            ),
                        );
                    },
                },
                8,
                () => persistent,
            );
        }
        const samples = [[imagePart()]];
        expect(
            await revisionModel("one").generateMediaEmbeddingBatch(samples),
        ).toEqual(success([[1, 0]]));
        expect(
            await revisionModel("two").generateMediaEmbeddingBatch(samples),
        ).toEqual(success([[0, 1]]));
        expect(
            await revisionModel("one").generateMediaEmbeddingBatch(samples),
        ).toEqual(success([[1, 0]]));
        expect(attempts).toBe(2);
        expect(values.size).toBe(2);
    });

    test("media keys and inference share an immutable input snapshot across queued work", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let seen: EmbeddingPart[][] = [];
        const source = {
            ...model(),
            async generateMediaEmbeddingBatch(samples: EmbeddingPart[][]) {
                await gate;
                seen = samples;
                return success([[1, 0]]);
            },
        };
        const text: Extract<EmbeddingPart, { type: "text" }> = {
            type: "text",
            text: "literal ",
        };
        const image = imagePart();
        const wrapped = createEmbeddingCache(source, 8);
        const pending = wrapped.generateMediaEmbeddingBatch([[text, image]]);
        text.text = "mutated";
        image.bytes[0] = 2;
        release();
        expect(await pending).toEqual(success([[1, 0]]));
        expect(seen).toEqual([
            [{ type: "text", text: "literal " }, imagePart()],
        ]);
        expect(
            wrapped.cache.has(
                mediaEmbeddingCacheKey(
                    [{ type: "text", text: "literal " }, imagePart()],
                    identity("document"),
                ),
            ),
        ).toBe(true);
    });
});
