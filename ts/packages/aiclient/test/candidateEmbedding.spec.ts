// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fileURLToPath } from "node:url";
import {
    createCandidateEmbeddingModel,
    createLazyCandidateEmbeddingModel,
    CandidateEmbeddingOptions,
} from "../src/candidateEmbedding.js";
import { tryCreateEmbeddingModel } from "../src/embeddingProvider.js";
import { embeddingIdentityKey } from "../src/embeddingIdentity.js";

const fixtureURL = new URL(
    "../../test/fixtures/candidateAdapter.mjs",
    import.meta.url,
);
const fixture = await import(fixtureURL.href);
const state = fixture.state as {
    creates: number;
    calls: unknown[];
    disposes: number;
    malformed: boolean;
    fail: boolean;
    gate: Promise<void> | undefined;
    vectors: number[][] | undefined;
    missingArtifactHash: boolean;
    missingMedia: boolean;
    adapterOptions: Array<{ localFilesOnly: boolean }>;
};
const options: CandidateEmbeddingOptions = {
    adapterPath: fileURLToPath(fixtureURL),
    runtimeDir: "unused",
    cacheDir: "unused",
    revision: "synthetic-pinned",
    maxPending: 1,
};

describe("explicit candidate bridge (offline synthetic adapter)", () => {
    beforeEach(() => {
        state.creates = 0;
        state.calls = [];
        state.disposes = 0;
        state.malformed = false;
        state.fail = false;
        state.gate = undefined;
        state.vectors = undefined;
        state.missingArtifactHash = false;
        state.missingMedia = false;
        state.adapterOptions = [];
    });

    test("factory option is lazy, exposes honest identity only after resolution, and dispatches text and media", async () => {
        const lazy = tryCreateEmbeddingModel(undefined, undefined, {
            candidate: options,
        });
        expect(state.creates).toBe(0);
        expect(lazy.embeddingIdentity).toBeUndefined();
        const model = await lazy.resolve();
        expect(model.embeddingIdentity?.task).toBe("document");
        expect(model.embeddingIdentity?.artifactHash).toBe("a".repeat(64));
        expect(await model.generateEmbedding("document")).toEqual({
            success: true,
            data: [1, 0],
        });
        const query = model.forRole("query");
        expect(query.embeddingIdentity?.prompt).toBe("query: ");
        expect(await query.generateEmbedding("query")).toEqual({
            success: true,
            data: [0, 1],
        });
        const parts = [
            [
                { type: "text" as const, text: "caption" },
                {
                    type: "image" as const,
                    bytes: new Uint8Array([1]),
                    sha256: "b".repeat(64),
                    mimeType: "image/png",
                },
            ],
        ];
        expect((await query.generateMediaEmbeddingBatch(parts)).success).toBe(
            true,
        );
        expect(state.calls).toEqual([
            { texts: ["document"], role: "document" },
            { texts: ["query"], role: "query" },
            { samples: parts, role: "query" },
        ]);
        await model.dispose();
        await model.dispose();
        expect((await query.generateEmbedding("after disposal")).success).toBe(
            false,
        );
        expect(state.disposes).toBe(1);
    });

    test("rejects malformed outputs and inference errors without fallback", async () => {
        const model = await createCandidateEmbeddingModel(options);
        state.malformed = true;
        expect((await model.generateEmbedding("bad")).success).toBe(false);
        state.malformed = false;
        state.fail = true;
        expect((await model.generateEmbedding("failure")).success).toBe(false);
        state.fail = false;
        expect((await model.generateEmbedding("failure")).success).toBe(true);
        await model.dispose();
    });

    test("local-files-only is explicit provenance forwarded to the adapter, never vector identity", async () => {
        const defaultModel = await createCandidateEmbeddingModel(options);
        const defaultIdentity = embeddingIdentityKey(
            defaultModel.embeddingIdentity,
        );
        expect(state.adapterOptions[0]).toMatchObject({
            runtimeDir: options.runtimeDir,
            cacheDir: options.cacheDir,
            revision: options.revision,
            localFilesOnly: false,
        });
        await defaultModel.dispose();
        const offlineModel = await createCandidateEmbeddingModel({
            ...options,
            localFilesOnly: true,
        });
        expect(state.adapterOptions[1].localFilesOnly).toBe(true);
        expect(offlineModel.metadata).toEqual({ local_files_only: true });
        expect(embeddingIdentityKey(offlineModel.embeddingIdentity)).toBe(
            defaultIdentity,
        );
        expect(state.calls).toEqual([]);
        await offlineModel.dispose();
    });

    test.each([
        [new Array<number[]>(1)],
        [[[NaN, 0]]],
        [[[1]]],
        [[[0, 0]]],
        [[[1, 1]]],
        [[new Array<number>(2)]],
    ])("rejects invalid candidate vectors: %j", async (vectors) => {
        const model = await createCandidateEmbeddingModel(options);
        state.vectors = vectors;
        expect((await model.generateEmbedding("invalid")).success).toBe(false);
        await model.dispose();
    });

    test.each(["missingMedia", "missingArtifactHash"] as const)(
        "unsupported adapter contract fails explicitly: %s",
        async (field) => {
            state[field] = true;
            await expect(
                createCandidateEmbeddingModel(options),
            ).rejects.toThrow();
            expect(state.disposes).toBe(1);
            expect(state.calls).toEqual([]);
        },
    );

    test("bounded queue and disposal drain active inference", async () => {
        const model = await createCandidateEmbeddingModel(options);
        let release!: () => void;
        state.gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const active = model.generateEmbedding("active");
        expect(
            (await model.forRole("query").generateEmbedding("overflow"))
                .success,
        ).toBe(false);
        await Promise.resolve();
        await Promise.resolve();
        let disposed = false;
        const disposal = model.dispose().then(() => {
            disposed = true;
        });
        await Promise.resolve();
        expect(disposed).toBe(false);
        release();
        await active;
        await disposal;
        expect(state.disposes).toBe(1);
    });

    test("missing adapter and invalid queue limits fail explicitly", async () => {
        const lazy = createLazyCandidateEmbeddingModel({
            ...options,
            adapterPath: "not-absolute",
        });
        await expect(lazy.resolve()).rejects.toThrow("absolute");
        expect((await lazy.generateEmbedding("no fallback")).success).toBe(
            false,
        );
        await lazy.dispose();
        expect(() =>
            createLazyCandidateEmbeddingModel({ ...options, maxPending: 0 }),
        ).toThrow();
    });
});
