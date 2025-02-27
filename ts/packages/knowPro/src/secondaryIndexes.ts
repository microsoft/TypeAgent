// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    IConversationSecondaryIndexes,
    Term,
} from "./dataFormat.js";
import { PropertyIndex, addToPropertyIndex } from "./propertyIndex.js";
import {
    TermsToRelatedTermIndexSettings,
    TermToRelatedTermsIndex,
} from "./relatedTermsIndex.js";
import {
    addToTimestampIndex,
    TimestampToTextRangeIndex,
} from "./timestampIndex.js";

export async function buildSecondaryIndexes(
    conversation: IConversation,
): Promise<IConversationSecondaryIndexes> {
    conversation.secondaryIndexes ??= new ConversationSecondaryIndexes();
    const secondaryIndexes = conversation.secondaryIndexes;
    const semanticRefs = conversation.semanticRefs;
    if (semanticRefs && secondaryIndexes.propertyToSemanticRefIndex) {
        addToPropertyIndex(
            semanticRefs,
            secondaryIndexes.propertyToSemanticRefIndex,
        );
    }
    if (secondaryIndexes.timestampIndex) {
        addToTimestampIndex(
            secondaryIndexes.timestampIndex,
            conversation.messages,
        );
    }
    return secondaryIndexes;
}

export class ConversationSecondaryIndexes
    implements IConversationSecondaryIndexes
{
    public propertyToSemanticRefIndex: PropertyIndex;
    public timestampIndex: TimestampToTextRangeIndex;
    public termToRelatedTermsIndex: TermToRelatedTermsIndex;

    constructor(settings: TermsToRelatedTermIndexSettings = {}) {
        this.propertyToSemanticRefIndex = new PropertyIndex();
        this.timestampIndex = new TimestampToTextRangeIndex();
        this.termToRelatedTermsIndex = new TermToRelatedTermsIndex(settings);
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
