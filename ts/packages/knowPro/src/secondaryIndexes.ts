// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    IConversationSecondaryIndexes,
    Term,
} from "./dataFormat.js";
import { PropertyIndex, buildPropertyIndex } from "./propertyIndex.js";
import {
    RelatedTermIndexSettings,
    RelatedTermsIndex,
} from "./relatedTermsIndex.js";
import {
    buildTimestampIndex,
    TimestampToTextRangeIndex,
} from "./timestampIndex.js";

export async function buildSecondaryIndexes(
    conversation: IConversation,
): Promise<void> {
    conversation.secondaryIndexes ??= new ConversationSecondaryIndexes();
    buildPropertyIndex(conversation);
    buildTimestampIndex(conversation);
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
