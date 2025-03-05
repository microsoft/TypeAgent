// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IConversationThreadData } from "./conversationThread.js";
import {
    IConversation,
    IConversationData,
    IConversationSecondaryIndexes,
    IndexingEventHandlers,
    Term,
} from "./interfaces.js";
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
    buildRelated: boolean,
    eventHandler?: IndexingEventHandlers,
): Promise<void> {
    conversation.secondaryIndexes ??= new ConversationSecondaryIndexes();
    buildPropertyIndex(conversation);
    buildTimestampIndex(conversation);
    if (buildRelated) {
        await buildRelatedTermsIndex(conversation, eventHandler);
    }
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
    threadData?: IConversationThreadData;
}
