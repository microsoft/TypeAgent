// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";

dotenv.config({
    path: new URL("../../../../.env", import.meta.url),
});

import { getData } from "typechat";
import {
    hasApiSettings,
    hasEmbeddingEndpoint,
    hasEmbeddingModel,
    testIf,
} from "./testCore.js";
import {
    createChatModelDefault,
    createEmbeddingModel,
    EnvVars,
} from "../src/openai.js";
import { TextEmbeddingModel } from "../src/models.js";

const testTimeout = 30000;
const smallEndpoint = "3_SMALL";

describe("openai.textEmbeddings", () => {
    const texts = [
        "Bach ate pizza while composing fugues",
        "Shakespeare did handstands while writing Macbeth",
    ];
    let standardModel: TextEmbeddingModel | undefined;
    beforeAll(() => {
        if (hasEmbeddingModel()) {
            standardModel = createEmbeddingModel();
        }
    });
    testIf(
        hasEmbeddingModel,
        "generate",
        async () => {
            await testEmbeddings(standardModel!, texts[0]);
        },
        testTimeout,
    );
    testIf(
        hasEmbeddingModel,
        "generateBatch",
        async () => {
            if (standardModel!.generateEmbeddingBatch) {
                const embeddings = getData(
                    await standardModel!.generateEmbeddingBatch(texts),
                );
                expect(embeddings.length).toEqual(texts.length);
                for (const e of embeddings) {
                    validateEmbedding(e);
                }
            }
        },
        testTimeout,
    );
    testIf(
        hasEmbeddingModel,
        "generateBatch.maxBatchSize",
        async () => {
            if (standardModel!.generateEmbeddingBatch) {
                const inputs = new Array(standardModel!.maxBatchSize + 1);
                inputs.fill("Foo");
                const result =
                    await standardModel!.generateEmbeddingBatch(inputs);
                expect(result.success).toBe(false);
            }
        },
        testTimeout,
    );
    testIf(
        () => hasEmbeddingEndpoint(smallEndpoint),
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
    testIf(
        () => hasApiSettings(EnvVars.AZURE_OPENAI_API_KEY),
        "createDefault",
        () => {
            const model = createChatModelDefault("test");
            expect(model.completionSettings.response_format).toBeDefined();
            expect(model.completionSettings.response_format?.type).toBe(
                "json_object",
            );
        },
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
