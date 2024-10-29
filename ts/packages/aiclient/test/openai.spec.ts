// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import dotenv from "dotenv";
import path from "path";

dotenv.config({
    path: path.join(__dirname, "../../../../.env"),
});

import { getData } from "typechat";
import { TextEmbeddingModel } from "../src/index.js";
import {
    createEmbeddingModel,
    hasApiSettings,
    hasEmbeddingModel,
    testIf,
} from "./testCore.js";
import { createChatModelDefault, EnvVars } from "../src/openai.js";

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
