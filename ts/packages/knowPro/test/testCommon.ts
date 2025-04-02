// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import {
    ChatModel,
    hasEnvSettings,
    openai,
    TextEmbeddingModel,
} from "aiclient";

import path from "path";
import {
    DeletionInfo,
    IConversation,
    IConversationSecondaryIndexes,
    IMessage,
    ITermToSemanticRefIndex,
    SemanticRef,
    PropertySearchTerm,
} from "../src/interfaces.js";
import {
    ConversationSettings,
    createConversationSettings,
} from "../src/conversation.js";
import { createConversationFromData } from "../src/common.js";
import { readConversationDataFromFile } from "../src/serialization.js";
import { SemanticRefSearchResult } from "../src/search.js";
import { createSearchTerm } from "../src/searchLib.js";
import * as q from "../src/query.js";
import { PropertyNames } from "../src/propertyIndex.js";
import { Result } from "typechat";
import { createEmbeddingCache, TextEmbeddingCache } from "knowledge-processor";

export class TestMessage implements IMessage {
    constructor(
        public textChunks: string[] = [],
        public tags: string[] = [],
        public timestamp?: string,
        public deletionInfo?: DeletionInfo,
    ) {}

    public getKnowledge() {
        return undefined;
    }
}

export class TestConversation implements IConversation<TestMessage> {
    public semanticRefs: SemanticRef[] | undefined;
    public semanticRefIndex?: ITermToSemanticRefIndex | undefined;
    public secondaryIndexes?: IConversationSecondaryIndexes | undefined;

    constructor(
        public nameTag: string,
        public tags: string[] = [],
        public messages: TestMessage[] = [],
    ) {}
}

export function emptyConversation() {
    return new TestConversation("Empty Conversation");
}

export function createMessage(messageText: string): TestMessage {
    const message = new TestMessage([messageText]);
    message.timestamp = createTimestamp();
    return message;
}

export function createTimestamp(): string {
    return new Date().toISOString();
}

export type TestModels = {
    chat: ChatModel;
    embeddings: TextEmbeddingModel;
};

export function createTestModels(): TestModels {
    return {
        chat: openai.createChatModelDefault("knowproTest"),
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

export function createOfflineConversationSettings(
    getCache: () => TextEmbeddingCache | undefined,
) {
    const cachingModel = createEmbeddingCache(
        new NullEmbeddingModel(),
        32,
        getCache,
    );
    return createConversationSettings(cachingModel);
}

export function loadTestConversation(
    settings: ConversationSettings,
): Promise<IConversation> {
    return createConversationFromFile(
        getAbsolutePath("./test/data"),
        "Episode_53_AdrianTchaikovsky_index",
        settings,
    );
}

export function testIf(
    name: string,
    runIf: () => boolean,
    fn: jest.ProvidesCallback,
    testTimeout?: number | undefined,
) {
    if (!runIf()) {
        return test.skip(name, () => {});
    }
    return test(name, fn, testTimeout);
}

export function shouldSkip() {
    return !hasTestKeys();
}

export function hasTestKeys() {
    const hasKeys: boolean =
        hasEnvSettings(process.env, openai.EnvVars.AZURE_OPENAI_API_KEY) &&
        hasEnvSettings(
            process.env,
            openai.EnvVars.AZURE_OPENAI_API_KEY_EMBEDDING,
        );
    return hasKeys;
}

export function getAbsolutePath(relativePath: string): string {
    return path.join(process.cwd(), relativePath);
}

export async function createConversationFromFile(
    dirPath: string,
    baseFileName: string,
    settings: ConversationSettings,
) {
    const data = await readConversationDataFromFile(
        dirPath,
        baseFileName,
        settings.relatedTermIndexSettings.embeddingIndexSettings?.embeddingSize,
    );
    if (data === undefined) {
        throw new Error(
            `Corrupt test data ${path.join(dirPath, baseFileName)}`,
        );
    }
    return createConversationFromData(data, settings);
}

export function getSemanticRefsForSearchResult(
    conversation: IConversation,
    result: SemanticRefSearchResult,
): SemanticRef[] {
    return conversation.semanticRefs
        ? result.semanticRefMatches.map(
              (m) => conversation.semanticRefs![m.semanticRefOrdinal],
          )
        : [];
}

export function findEntityWithName(
    semanticRefs: SemanticRef[],
    entityName: string,
): SemanticRef | undefined {
    const searchTerm: PropertySearchTerm = {
        propertyName: PropertyNames.EntityName,
        propertyValue: createSearchTerm(entityName),
    };
    return semanticRefs.find((sr) =>
        q.matchPropertySearchTermToEntity(searchTerm, sr),
    );
}

export function createQueryContext(conversation: IConversation) {
    const secondaryIndexes = conversation.secondaryIndexes!;
    return new q.QueryEvalContext(
        conversation,
        secondaryIndexes.propertyToSemanticRefIndex,
        secondaryIndexes.timestampIndex,
    );
}

function nullMethodError() {
    return new Error("Null method; not implemented.");
}
