// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    EmbeddingIdentity,
    embeddingIdentityKey,
    validateEmbeddingPairing,
    validateEmbeddingVector,
} from "../src/embeddingIdentity.js";
import { embeddingModelForRole, TextEmbeddingModel } from "../src/models.js";
import { success } from "typechat";

const identity: EmbeddingIdentity = {
    schemaVersion: 1,
    provider: "local",
    model: "synthetic",
    revision: "pinned",
    dimensions: 2,
    task: "document",
    prompt: "",
    pooling: "mean",
    normalization: "l2",
    preprocessing: "text",
    artifactHash: "a".repeat(64),
};

describe("embedding identity contract", () => {
    test("canonical keys ignore property order and bind every semantic field", () => {
        const reversed = Object.fromEntries(
            Object.entries(identity).reverse(),
        ) as unknown as EmbeddingIdentity;
        expect(embeddingIdentityKey(reversed)).toBe(
            embeddingIdentityKey(identity),
        );
        expect(
            embeddingIdentityKey({
                ...identity,
                measuredLatency: 123,
                provenance: "run-two",
            } as EmbeddingIdentity),
        ).toBe(embeddingIdentityKey(identity));
        const changes: Partial<EmbeddingIdentity>[] = [
            { provider: "other" },
            { model: "other" },
            { revision: "other" },
            { dimensions: 3 },
            { task: "query" },
            { prompt: "query: " },
            { pooling: "cls" },
            { preprocessing: "rgb" },
            { artifactHash: "b".repeat(64) },
        ];
        for (const change of changes) {
            expect(embeddingIdentityKey({ ...identity, ...change })).not.toBe(
                embeddingIdentityKey(identity),
            );
        }
    });

    test("rejects incomplete identity and malformed vectors", () => {
        for (const change of [
            { dimensions: 0 },
            { artifactHash: "" },
            { model: "" },
        ]) {
            expect(() =>
                embeddingIdentityKey({ ...identity, ...change }),
            ).toThrow();
        }
        validateEmbeddingVector([1, 0], 2);
        for (const vector of [
            [],
            [0, 0],
            [1],
            [NaN, 0],
            [Infinity, 0],
            [1, 1],
            new Array<number>(2),
        ]) {
            expect(() => validateEmbeddingVector(vector, 2)).toThrow();
        }
    });

    test("asymmetric spaces require exact pairing evidence", () => {
        const query: EmbeddingIdentity = {
            ...identity,
            task: "query",
            prompt: "query: ",
        };
        const pairing = {
            queryIdentity: embeddingIdentityKey(query),
            documentIdentity: embeddingIdentityKey(identity),
            evidenceSha256: "c".repeat(64),
        };
        validateEmbeddingPairing(pairing, query, identity);
        expect(() =>
            validateEmbeddingPairing(
                pairing,
                { ...query, revision: "changed" },
                identity,
            ),
        ).toThrow();
        expect(() =>
            validateEmbeddingPairing(
                { ...pairing, evidenceSha256: "" },
                query,
                identity,
            ),
        ).toThrow();
        expect(() =>
            validateEmbeddingPairing(pairing, identity, query),
        ).toThrow();
    });

    test("legacy role helper is unchanged and identity-bearing mismatches fail closed", () => {
        const legacy: TextEmbeddingModel = {
            maxBatchSize: 1,
            async generateEmbedding() {
                return success([1, 0]);
            },
        };
        expect(embeddingModelForRole(legacy, "query")).toBe(legacy);
        expect(() =>
            embeddingModelForRole(
                { ...legacy, embeddingIdentity: identity },
                "query",
            ),
        ).toThrow();
    });
});
