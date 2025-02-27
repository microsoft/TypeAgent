// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IConversationThreads } from "./conversationThread.js";
import {
    IPropertyToSemanticRefIndex,
    ITermToRelatedTermsIndex,
    ITimestampToTextRangeIndex,
    Term,
} from "./dataFormat.js";

/**
 * Optional secondary indexes that can help the query processor produce better results, but are not required
 */
export interface IConversationSecondaryIndexes {
    termToRelatedTermsIndex?: ITermToRelatedTermsIndex | undefined;
    propertyToSemanticRefIndex?: IPropertyToSemanticRefIndex | undefined;
    timestampIndex?: ITimestampToTextRangeIndex | undefined;
    threads?: IConversationThreads | undefined;
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
