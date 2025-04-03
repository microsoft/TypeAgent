// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import { getAbsolutePath, NullEmbeddingModel, readTestFile } from "test-lib";
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

export const defaultConversationName = "Episode_53_AdrianTchaikovsky_index";

export function loadTestConversation(
    settings: ConversationSettings,
    name?: string,
): Promise<IConversation> {
    name ??= defaultConversationName;
    return createConversationFromFile(
        getAbsolutePath("./test/data"),
        name,
        settings,
    );
}

export function loadTestQueries(
    relativePath: string,
): Record<string, string>[] {
    const json = readTestFile(relativePath);
    return JSON.parse(json);
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
