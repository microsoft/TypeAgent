// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "aiclient";
import { createEmbeddingCache } from "../src/modelCache.js";
import { hasTestKeys, testIf } from "./testCore.js";
import { getData } from "typechat";

describe("modelCache", () => {
    const testTimeout = 1000 * 60 * 10;
    const texts = [
        "Bach always served Pizza with his Toccata and Fugue",
        "Shakespeare purchased his wood from Macbeth",
        "Nirvana's deodorant smelt like teen spirit!",
        "Steely Dan's pretzels were full of logic",
        "Jane Austen drank Darjeeling tea in Mansfield Park",
        "The Count of Monte Cristo went up to 11",
    ];
    testIf(
        "cache",
        () => hasTestKeys(),
        async () => {
            const cacheSize = 3;
            const embeddingModel = openai.createEmbeddingModel();
            const model = createEmbeddingCache(embeddingModel, cacheSize);
            for (let i = 0; i < cacheSize; ++i) {
                await model.generateEmbedding(texts[i]);
            }
            expect(model.cache.size).toEqual(cacheSize);
            for (let i = 0; i < cacheSize; ++i) {
                expect(model.cache.has(texts[i])).toBeTruthy();
            }
            let i = cacheSize;
            await model.generateEmbedding(texts[i]);
            expect(model.cache.size).toEqual(cacheSize);
            expect(model.cache.has(texts[i])).toBeTruthy();
            expect(model.cache.has(texts[0])).toBeFalsy();

            ++i;
            await model.generateEmbedding(texts[i]);
            expect(model.cache.size).toEqual(cacheSize);
            expect(model.cache.has(texts[i])).toBeTruthy();
            expect(model.cache.has(texts[0])).toBeFalsy();
            expect(model.cache.has(texts[1])).toBeFalsy();

            await model.generateEmbedding(texts[cacheSize - 1]);
            expect(model.cache.size).toEqual(cacheSize);

            ++i;
            await model.generateEmbedding(texts[i]);
            expect(model.cache.has(texts[cacheSize - 1]));
        },
        testTimeout,
    );
    testIf(
        "cache.batch",
        () => hasTestKeys(),
        async () => {
            const cacheSize = 3;
            const embeddingModel = openai.createEmbeddingModel();
            const model = createEmbeddingCache(embeddingModel, cacheSize);
            let embeddings = getData(
                await model.generateEmbeddingBatch!(
                    texts.slice(1, cacheSize + 1),
                ),
            );
            expect(embeddings).toHaveLength(cacheSize);
            expect(model.cache.size).toEqual(cacheSize);

            embeddings = getData(
                await model.generateEmbeddingBatch!(
                    texts.slice(0, cacheSize + 2),
                ),
            );
            expect(embeddings).toHaveLength(cacheSize + 2);
            expect(model.cache.size).toEqual(cacheSize);
            expect(model.cache.has(texts[0]));
            expect(model.cache.has(texts[cacheSize]));
            expect(model.cache.has(texts[cacheSize + 1]));
        },
    );
});
