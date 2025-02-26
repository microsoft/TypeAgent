// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IConversationThreads } from "./conversationThread.js";
import {
    SemanticRefIndex,
    ScoredSemanticRef,
    DateRange,
    TextRange,
    Term,
    MessageIndex,
} from "./dataFormat.js";

/**
 * Optional secondary indexes that can help the query processor produce better results, but are not required
 */
export interface IConversationSecondaryIndexes {
    termToRelatedTermsIndex?: ITermToRelatedTermsIndex | undefined;
    propertyToSemanticRefIndex: IPropertyToSemanticRefIndex | undefined;
    timestampIndex?: ITimestampToTextRangeIndex | undefined;
    threads?: IConversationThreads | undefined;
}

/**
 * Allows for faster retrieval of name, value properties
 */
export interface IPropertyToSemanticRefIndex {
    getValues(): string[];
    addProperty(
        propertyName: string,
        value: string,
        semanticRefIndex: SemanticRefIndex | ScoredSemanticRef,
    ): void;
    lookupProperty(
        propertyName: string,
        value: string,
    ): ScoredSemanticRef[] | undefined;
}

export type TimestampedTextRange = {
    timestamp: string;
    range: TextRange;
};

/**
 * Return text ranges in the given date range
 */
export interface ITimestampToTextRangeIndex {
    addTimestamp(messageIndex: MessageIndex, timestamp: string): boolean;
    lookupRange(dateRange: DateRange): TimestampedTextRange[];
}

/**
 * Work in progress.
 */
export interface ITermToRelatedTermsIndex {
    get aliases(): ITermToRelatedTerms | undefined;
    get fuzzyIndex(): ITermToRelatedTermsFuzzy | undefined;
    serialize(): ITermsToRelatedTermsIndexData;
    deserialize(data?: ITermsToRelatedTermsIndexData): void;
}

export interface ITermToRelatedTerms {
    lookupTerm(text: string): Term[] | undefined;
}

export interface ITermToRelatedTermsFuzzy {
    lookupTerm(
        text: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<Term[]>;
    lookupTerms(
        textArray: string[],
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<Term[][]>;
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
