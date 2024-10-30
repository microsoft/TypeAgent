// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License

import dotenv from "dotenv";
import path from "path";

dotenv.config({
    path: path.join(__dirname, "../../../../.env"),
});

import { openai } from "aiclient";
import { hasEmbeddingModel, testIf } from "./common";
import { generateTextEmbeddings } from "../src/vector/vectorIndex";

describe("vector.vectorIndex", () => {
    const timeoutMs = 5 * 1000 * 60;

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
