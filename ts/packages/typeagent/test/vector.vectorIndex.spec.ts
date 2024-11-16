// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import path from "path";

dotenv.config({
    path: path.join(__dirname, "../../../../.env"),
});

import { openai } from "aiclient";
import { generateRandomEmbedding, hasEmbeddingModel, testIf } from "./common";
import { generateTextEmbeddings } from "../src/vector/vectorIndex";
import {
    cosineSimilarity,
    cosineSimilarityLoop,
    dotProduct,
    dotProductSimple,
    euclideanLength,
} from "../src/vector/vector";
import { createSemanticList } from "../src";

describe("vector.vectorIndex", () => {
    const timeoutMs = 5 * 1000 * 60;
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
            const model = openai.createEmbeddingModel();
            const embeddings = await generateTextEmbeddings(model, strings);
            expect(embeddings).toHaveLength(strings.length);
        },
        timeoutMs,
    );
    testIf(hasEmbeddingModel, "semanticList", async () => {
        const strings = [
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
        const model = openai.createEmbeddingModel();
        const semanticList = createSemanticList(model);
        await semanticList.pushMultiple(strings);
        expect(semanticList.values).toHaveLength(strings.length);
    });
});
