// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import dotenv from "dotenv";
import path from "path";

dotenv.config({
    path: path.join(__dirname, "../../../../.env"),
});

import { getData } from "typechat";
import { TextEmbeddingModel } from "../src/index.js";
import { createEmbeddingModel, hasEmbeddingModel, testIf } from "./testCore.js";

const testTimeout = 30000;
const smallEndpoint = "3_SMALL";

describe("openai.textEmbeddings", () => {
    const texts = [
        "Bach ate pizza while composing fugues",
        "Shakespeare did handstands while writing Macbeth",
    ];
    testIf(
        hasEmbeddingModel,
        "generate",
        async () => {
            const model = createEmbeddingModel();
            await testEmbeddings(model, texts[0]);
        },
        testTimeout,
    );
    testIf(
        () => hasEmbeddingModel(smallEndpoint),
        "generateSmall",
        async () => {
            let model = createEmbeddingModel(smallEndpoint);
            await testEmbeddings(model, texts[0]);

            let dimensions = 512;
            model = createEmbeddingModel(smallEndpoint, dimensions);
            await testEmbeddings(model, texts[0], dimensions);
        },
        testTimeout,
    );

    async function testEmbeddings(
        model: TextEmbeddingModel,
        text: string,
        dimensions?: number,
    ) {
        const embedding = getData(await model.generateEmbedding(text));
        validateEmbedding(embedding, dimensions);
    }

    function validateEmbedding(embedding: number[], dimensions?: number) {
        expect(embedding).not.toBeUndefined();
        expect(embedding.length).toBeGreaterThan(0);
        if (dimensions) {
            expect(embedding.length).toBe(dimensions);
        }
    }
});
