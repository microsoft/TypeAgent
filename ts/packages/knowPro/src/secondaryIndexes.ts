// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IConversationThreadData } from "./conversationThread.js";
import { ConversationSettings } from "./import.js";
import {
    IConversation,
    IConversationData,
    IConversationSecondaryIndexes,
    IndexingEventHandlers,
    SecondaryIndexingResults,
    Term,
} from "./interfaces.js";
import { IMessageTextIndexData } from "./messageIndex.js";
import { PropertyIndex, buildPropertyIndex } from "./propertyIndex.js";
import {
    buildRelatedTermsIndex,
    RelatedTermIndexSettings,
    RelatedTermsIndex,
} from "./relatedTermsIndex.js";
import {
    buildTimestampIndex,
    TimestampToTextRangeIndex,
} from "./timestampIndex.js";

export async function buildSecondaryIndexes(
    conversation: IConversation,
    conversationSettings: ConversationSettings,
    buildRelated: boolean,
    eventHandler?: IndexingEventHandlers,
): Promise<SecondaryIndexingResults> {
    conversation.secondaryIndexes ??= new ConversationSecondaryIndexes();
    const result: SecondaryIndexingResults = {};
    result.properties = buildPropertyIndex(conversation);
    result.timestamps = buildTimestampIndex(conversation);
    if (buildRelated) {
        result.relatedTerms = await buildRelatedTermsIndex(
            conversation,
            conversationSettings,
            eventHandler,
        );
    }
    return result;
}

export class ConversationSecondaryIndexes
    implements IConversationSecondaryIndexes
{
    public propertyToSemanticRefIndex: PropertyIndex;
    public timestampIndex: TimestampToTextRangeIndex;
    public termToRelatedTermsIndex: RelatedTermsIndex;

    constructor(settings: RelatedTermIndexSettings = {}) {
        this.propertyToSemanticRefIndex = new PropertyIndex();
        this.timestampIndex = new TimestampToTextRangeIndex();
        this.termToRelatedTermsIndex = new RelatedTermsIndex(settings);
    }
}

export interface ITermsToRelatedTermsIndexData {
    aliasData?: ITermToRelatedTermsData | undefined;
    textEmbeddingData?: ITextEmbeddingIndexData | undefined;
}

export interface ITermToRelatedTermsData {
    relatedTerms?: ITermsToRelatedTermsDataItem[] | undefined;
}

export interface ITermsToRelatedTermsDataItem {
    termText: string;
    relatedTerms: Term[];
}

export interface ITextEmbeddingIndexData {
    textItems: string[];
    embeddings: Float32Array[];
}

export interface IConversationDataWithIndexes<TMessage = any>
    extends IConversationData<TMessage> {
    relatedTermsIndexData?: ITermsToRelatedTermsIndexData | undefined;
    threadData?: IConversationThreadData | undefined;
    messageIndexData?: IMessageTextIndexData | undefined;
}
