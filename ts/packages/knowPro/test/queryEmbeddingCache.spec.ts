// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TextEmbeddingModel } from "@typeagent/aiclient";
import { success } from "typechat";
import {
    queryEmbedding,
    queryEmbeddings,
    withQueryEmbeddingCache,
} from "../src/queryEmbeddingCache.js";

function model(): TextEmbeddingModel {
    return { maxBatchSize: 8, generateEmbedding: async () => success([1, 0]) };
}
const vector = () => new Float32Array([1, 0]);

describe("request-local query embedding reuse", () => {
    test("deduplicates exact terms in batches and concurrent fallback calls", async () => {
        const identity = model();
        const calls: string[][] = [];
        await withQueryEmbeddingCache(async () => {
            const generate = async (texts: string[]) => {
                calls.push(texts);
                return texts.map(vector);
            };
            const [batch, fallback] = await Promise.all([
                queryEmbeddings(
                    identity,
                    ["alias", "query", "alias"],
                    generate,
                ),
                queryEmbeddings(identity, ["query"], generate),
            ]);
            expect(batch).toEqual([vector(), vector(), vector()]);
            expect(fallback).toEqual([vector()]);
        });
        expect(calls).toEqual([["alias", "query"]]);
    });

    test("does not share models, requests, disabled scopes or normalization variants", async () => {
        const identity = model();
        let calls = 0;
        const generate = async () => {
            calls++;
            return vector();
        };
        for (let request = 0; request < 2; request++)
            await withQueryEmbeddingCache(async () => {
                await queryEmbedding(identity, "Query", generate);
                await queryEmbedding(identity, "Query", generate);
                await queryEmbedding(identity, "query", generate);
                await queryEmbedding(model(), "Query", generate);
                await withQueryEmbeddingCache(async () => {
                    await queryEmbedding(identity, "Query", generate);
                }, false);
            });
        expect(calls).toBe(8);
    });

    test("failed attempts are not cached as successful fallback results", async () => {
        const identity = model();
        await withQueryEmbeddingCache(async () => {
            await expect(
                queryEmbedding(identity, "query", async () => {
                    throw new Error("provider unavailable");
                }),
            ).rejects.toThrow("provider unavailable");
            await expect(
                queryEmbedding(identity, "query", async () => vector()),
            ).resolves.toEqual(vector());
        });
    });

    test("cache capacity never truncates a query or changes result cardinality", async () => {
        const identity = model();
        const texts = Array.from({ length: 300 }, (_, index) => String(index));
        await withQueryEmbeddingCache(async () => {
            const results = await queryEmbeddings(
                identity,
                texts,
                async (items) => {
                    expect(items).toEqual(texts);
                    return items.map(vector);
                },
            );
            expect(results).toHaveLength(300);
        });
    });
});
