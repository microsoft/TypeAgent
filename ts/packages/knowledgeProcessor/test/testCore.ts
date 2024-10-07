// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, openai, TextEmbeddingModel } from "aiclient";
import { TextBlock, TextBlockType } from "../src/text.js";
import { readAllText } from "typeagent";
import { splitIntoBlocks } from "../src/textChunker.js";

export type TestModels = {
    chat: ChatModel;
    embeddings: TextEmbeddingModel;
};

export interface TestContext {
    models: TestModels;
}

export function shouldSkip() {
    return !hasTestKeys();
}

export function hasTestKeys() {
    const env = process.env;
    return (
        env[openai.EnvVars.AZURE_OPENAI_API_KEY] &&
        env[openai.EnvVars.AZURE_OPENAI_API_KEY_EMBEDDING]
    );
}

export function skipTest(name: string) {
    return test.skip(name, () => {});
}

export function createTestModels(): TestModels {
    return {
        chat: openai.createChatModel(),
        embeddings: openai.createEmbeddingModel(),
    };
}

export function createContext(): TestContext {
    return {
        models: createTestModels(),
    };
}

export async function loadData(
    filePath: string,
    blockType = TextBlockType.Paragraph,
): Promise<TextBlock<any>[]> {
    const playText = await readAllText(filePath);
    // Split full play text into paragraphs
    return splitIntoBlocks(playText, blockType);
}
