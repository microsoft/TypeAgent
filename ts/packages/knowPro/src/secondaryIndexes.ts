// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SemanticRefIndex,
    ScoredSemanticRef,
    DateRange,
    TextRange,
    Term,
} from "./dataFormat.js";

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
    lookupRange(dateRange: DateRange): TimestampedTextRange[];
} /**
 * Secondary indexes are currently optional, allowing us to experiment
 */

export interface IConversationSecondaryIndexes {
    termToRelatedTermsIndex?: ITermToRelatedTermsIndex | undefined;
    propertyToSemanticRefIndex: IPropertyToSemanticRefIndex | undefined;
    timestampIndex?: ITimestampToTextRangeIndex | undefined;
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

export interface ITermToRelatedTerms {
    lookupTerm(text: string): Term[] | undefined;
}

export interface ITextEmbeddingIndexData {
    modelName?: string | undefined;
    embeddingData?: ITextEmbeddingDataItem[] | undefined;
}

export interface ITextEmbeddingDataItem {
    text: string;
    embedding: number[];
}
