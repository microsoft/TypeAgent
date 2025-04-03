// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
const envUrl = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envUrl });

import {
    ChatModel,
    hasEnvSettings,
    openai,
    TextEmbeddingModel,
} from "aiclient";
import { Result } from "typechat";

export function hasTestKeys() {
    const hasKeys: boolean =
        hasEnvSettings(process.env, openai.EnvVars.AZURE_OPENAI_API_KEY) &&
        hasEnvSettings(
            process.env,
            openai.EnvVars.AZURE_OPENAI_API_KEY_EMBEDDING,
        );
    return hasKeys;
}

export type TestModels = {
    chat: ChatModel;
    embeddings: TextEmbeddingModel;
};

export function createTestEmbeddingModel(): [TextEmbeddingModel, number] {
    return [openai.createEmbeddingModel(), 1536];
}

export function createTestModels(testName: string): TestModels {
    return {
        chat: openai.createChatModelDefault(testName),
        embeddings: openai.createEmbeddingModel(),
    };
}

export class NullEmbeddingModel implements TextEmbeddingModel {
    constructor(public maxBatchSize: number = 1) {}

    public generateEmbeddingBatch?(
        inputs: string[],
    ): Promise<Result<number[][]>> {
        throw nullMethodError();
    }

    public generateEmbedding(input: string): Promise<Result<number[]>> {
        throw nullMethodError();
    }
}

function nullMethodError() {
    return new Error("Null method; not implemented.");
}
