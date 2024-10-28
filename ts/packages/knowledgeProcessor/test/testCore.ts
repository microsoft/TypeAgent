// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, openai, TextEmbeddingModel } from "aiclient";
import { TextBlock, TextBlockType } from "../src/text.js";
import { readAllText, readJsonFile } from "typeagent";
import { splitIntoBlocks } from "../src/textChunker.js";
import { SearchTermsActionV2 } from "../src/conversation/knowledgeTermSearchSchema2.js";
import path from "path";
import os from "node:os";

export type TestModels = {
    chat: ChatModel;
    embeddings: TextEmbeddingModel;
};

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
        chat: openai.createChatModelDefault("knowledgeProcessorTest"),
        embeddings: openai.createEmbeddingModel(),
    };
}

export function getRootDataPath() {
    return path.join(os.tmpdir(), "/data/tests");
}

export async function loadData(
    filePath: string,
    blockType = TextBlockType.Paragraph,
): Promise<TextBlock<any>[]> {
    const playText = await readAllText(filePath);
    // Split full play text into paragraphs
    return splitIntoBlocks(playText, blockType);
}

export type SearchAction = {
    query: string;
    action: SearchTermsActionV2;
};

export async function loadSearchActionV2(
    rootPath: string,
    name: string,
): Promise<SearchAction> {
    const query = await readAllText(path.join(rootPath, name + ".txt"));
    const action: SearchTermsActionV2 | undefined = await readJsonFile(
        path.join(rootPath, name + ".json"),
    );
    if (!action) {
        throw Error(`${name}.json not found`);
    }
    return {
        query,
        action,
    };
}
