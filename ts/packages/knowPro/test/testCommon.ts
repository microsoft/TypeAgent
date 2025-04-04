// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import {
    getAbsolutePath,
    NullEmbeddingModel,
    parseCommandArgs,
    readTestFileLines,
} from "test-lib";
import {
    DeletionInfo,
    IConversation,
    IConversationSecondaryIndexes,
    IMessage,
    ITermToSemanticRefIndex,
    SemanticRef,
    PropertySearchTerm,
    SearchTermGroup,
} from "../src/interfaces.js";
import {
    ConversationSettings,
    createConversationSettings,
    getTimeRangeForConversation,
} from "../src/conversation.js";
import { createConversationFromData } from "../src/common.js";
import { readConversationDataFromFile } from "../src/serialization.js";
import {
    SearchOptions,
    SearchSelectExpr,
    SemanticRefSearchResult,
    WhenFilter,
} from "../src/search.js";
import {
    createOrTermGroup,
    createPropertySearchTerms,
    createSearchTerm,
    createSearchTerms,
} from "../src/searchLib.js";
import * as q from "../src/query.js";
import { PropertyNames } from "../src/propertyIndex.js";
import { createEmbeddingCache, TextEmbeddingCache } from "knowledge-processor";
import { ConversationSecondaryIndexes } from "../src/secondaryIndexes.js";
import { openai } from "aiclient";
import { dateTime } from "typeagent";

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

export function createOnlineConversationSettings(
    getCache: () => TextEmbeddingCache | undefined,
) {
    const cachingModel = createEmbeddingCache(
        openai.createEmbeddingModel(),
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

export async function loadTestConversationForOffline(name?: string) {
    //  This is held in a closure and used to service cache queries
    let secondaryIndex: ConversationSecondaryIndexes | undefined;
    let settings = createOfflineConversationSettings(() => {
        return secondaryIndex?.termToRelatedTermsIndex.fuzzyIndex;
    });
    const conversation = await loadTestConversation(settings);
    secondaryIndex =
        conversation.secondaryIndexes as ConversationSecondaryIndexes;
    return conversation;
}

export async function loadTestConversationForOnline(name?: string) {
    //  This is held in a closure and used to service cache queries
    let secondaryIndex: ConversationSecondaryIndexes | undefined;
    let settings = createOnlineConversationSettings(() => {
        return secondaryIndex?.termToRelatedTermsIndex.fuzzyIndex;
    });
    const conversation = await loadTestConversation(settings);
    secondaryIndex =
        conversation.secondaryIndexes as ConversationSecondaryIndexes;
    return conversation;
}

export function loadTestQueries(filePath: string): string[] {
    const lines = readTestFileLines(filePath);
    return lines.filter((l) => !l.startsWith("#"));
}

export function parseTestQuery(
    conversation: IConversation,
    query: string,
): SearchSelectExpr {
    const cmdArgs = parseCommandArgs(query);
    const when = cmdArgs.namedArgs
        ? parseWhenFilter(conversation, cmdArgs.namedArgs)
        : undefined;

    return {
        searchTermGroup: parseSearchTermGroup(cmdArgs.args, cmdArgs.namedArgs),
        when,
    };
}

export function parseSearchTermGroup(
    terms?: string[],
    propertyTerms?: Record<string, string>,
): SearchTermGroup {
    const termGroup = createOrTermGroup();
    if (terms) {
        termGroup.terms.push(...createSearchTerms(terms));
    }
    if (propertyTerms) {
        termGroup.terms.push(...createPropertySearchTerms(propertyTerms));
    }
    return termGroup;
}

export function parseWhenFilter(
    conversation: IConversation,
    namedArgs: Record<string, any>,
): WhenFilter {
    let filter: WhenFilter = {
        knowledgeType: namedArgs.ktype,
    };
    const dateRange = getTimeRangeForConversation(conversation);
    if (dateRange) {
        let startDate: Date | undefined;
        let endDate: Date | undefined;
        // Did they provide an explicit date range?
        if (namedArgs.startDate || namedArgs.endDate) {
            startDate = stringToDate(namedArgs.startDate) ?? dateRange.start;
            endDate = stringToDate(namedArgs.endDate) ?? dateRange.end;
        } else {
            // They may have provided a relative date range
            if (namedArgs.startMinute >= 0) {
                startDate = dateTime.addMinutesToDate(
                    dateRange.start,
                    namedArgs.startMinute,
                );
            }
            if (namedArgs.endMinute > 0) {
                endDate = dateTime.addMinutesToDate(
                    dateRange.start,
                    namedArgs.endMinute,
                );
            }
        }
        if (startDate) {
            filter.dateRange = {
                start: startDate,
                end: endDate,
            };
        }
    }
    const keysToDelete = [
        "ktype",
        "startDate",
        "endDate",
        "startMinute",
        "endMinute",
    ];
    keysToDelete.forEach((key) => delete namedArgs[key]);
    return filter;
}

export function stringToDate(value: string | undefined): Date | undefined {
    return value ? dateTime.stringToDate(value) : undefined;
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

export function createTestSearchOptions(): SearchOptions {
    return {
        usePropertyIndex: true,
        useTimestampIndex: true,
    };
}

export function stringify(obj: any) {
    return JSON.stringify(obj, undefined, 2);
}
