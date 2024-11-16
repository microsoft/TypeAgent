// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import path from "path";

dotenv.config({
    path: path.join(__dirname, "../../../../.env"),
});

import { openai, TextEmbeddingModel } from "aiclient";
import { generateRandomEmbedding, hasEmbeddingModel, testIf } from "./common";
import { generateTextEmbeddings } from "../src/vector/vectorIndex";
import {
    cosineSimilarity,
    cosineSimilarityLoop,
    dotProduct,
    dotProductSimple,
    euclideanLength,
} from "../src/vector/vector";
import { createSemanticList } from "../src/vector/semanticList";
import { createSemanticMap } from "../src/vector/semanticMap";

describe("vector.vectorIndex", () => {
    const timeoutMs = 5 * 1000 * 60;
    let model: TextEmbeddingModel | undefined;
    beforeAll(() => {
        if (hasEmbeddingModel()) {
            model = openai.createEmbeddingModel();
        }
    });
    test("dot", () => {
        const length = 1536;
        const x = generateRandomEmbedding(length);
        const y = generateRandomEmbedding(length);
        const dot = dotProduct(x, y);
        const dot2 = dotProductSimple(x, y);
        expect(dot).toEqual(dot2);
    });
    test("cosine", () => {
        const length = 1536;
        const x = generateRandomEmbedding(length);
        const y = generateRandomEmbedding(length);
        const cosine = cosineSimilarityLoop(x, y, euclideanLength(y));
        const cosine2 = cosineSimilarity(x, y);
        expect(cosine).toEqual(cosine2);
    });
    testIf(
        hasEmbeddingModel,
        "generateEmbeddings",
        async () => {
            const strings = [
                "Apples and Bananas",
                "Dolphins and Whales",
                "Mountains and Streams",
                "Science and Technology",
            ];
            const embeddings = await generateTextEmbeddings(model!, strings);
            expect(embeddings).toHaveLength(strings.length);
        },
        timeoutMs,
    );

    const smallStrings = [
        "object",
        "person",
        "composer",
        "instrument",
        "book",
        "movie",
        "dog",
        "cat",
        "computer",
        "phone",
    ];
    testIf(
        hasEmbeddingModel,
        "semanticList",
        async () => {
            const semanticList = createSemanticList<string>(model!);
            await semanticList.pushMultiple(smallStrings);
            expect(semanticList.values).toHaveLength(smallStrings.length);

            for (let i = 0; i < smallStrings.length; ++i) {
                const item = semanticList.values[i];
                const embedding = item.embedding;
                const match = await semanticList.nearestNeighbor(embedding);
                expect(match).toBeDefined();
                if (match) {
                    expect(match.item).toBe(item.value);
                }
            }
        },
        timeoutMs,
    );
    testIf(
        hasEmbeddingModel,
        "semanticMap",
        async () => {
            const semanticMap = await createSemanticMap<string>(model!);
            // First add some of the strings
            const firstHalf = smallStrings.slice(0, 5);
            await semanticMap.setMultiple(firstHalf.map((s) => [s, s]));
            expect(semanticMap.size).toBe(firstHalf.length);
            // Now add all the strings. This should only add the new strings
            await semanticMap.setMultiple(smallStrings.map((s) => [s, s]));
            expect(semanticMap.size).toBe(smallStrings.length);

            const match = await semanticMap.getNearest(smallStrings[0]);
            expect(match).toBeDefined();
            if (match) {
                expect(match.item).toBe(smallStrings[0]);
            }
        },
        timeoutMs,
    );
});
