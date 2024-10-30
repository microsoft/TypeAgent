// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import path from "path";

dotenv.config({
    path: path.join(__dirname, "../../../../.env"),
});

import { openai } from "aiclient";
import { hasEmbeddingModel, testIf } from "./common";
import { generateTextEmbeddings } from "../src/vector/vectorIndex";
import { dotProduct, dotProductSimple } from "../src/vector/vector";

describe("vector.vectorIndex", () => {
    const timeoutMs = 5 * 1000 * 60;
    test("dot", () => {
        const length = 1536;
        const x = new Array<number>(length).fill(0.37);
        const y = new Array<number>(length).fill(0.15);
        const dot = dotProduct(x, y);
        const dot2 = dotProductSimple(x, y);
        expect(dot).toEqual(dot2);
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
});
