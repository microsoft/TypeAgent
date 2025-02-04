// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation } from "knowledge-processor";

// an object that can provide a KnowledgeResponse structure
export interface IKnowledgeSource {
    getKnowledge: () => conversation.KnowledgeResponse;
}

export interface DeletionInfo {
    timestamp: string;
    reason?: string;
}

export interface IMessage<TMeta extends IKnowledgeSource = any> {
    // the text of the message, split into chunks
    textChunks: string[];
    // for example, e-mail has a subject, from and to fields; a chat message has a sender and a recipient
    metadata: TMeta;
    timestamp?: string | undefined;
    tags: string[];
    deletionInfo?: DeletionInfo;
}

export interface ITermToSemanticRefIndexItem {
    term: string;
    semanticRefIndices: ScoredSemanticRef[];
}
// persistent form of a term index
export interface ITermToSemanticRefIndexData {
    items: ITermToSemanticRefIndexItem[];
}

export type SemanticRefIndex = number;

export type ScoredSemanticRef = {
    semanticRefIndex: SemanticRefIndex;
    score: number;
};

export interface ITermToSemanticRefIndex {
    getTerms(): string[];
    addTerm(
        term: string,
        semanticRefIndex: SemanticRefIndex | ScoredSemanticRef,
    ): void;
    removeTerm(term: string, semanticRefIndex: SemanticRefIndex): void;
    lookupTerm(term: string): ScoredSemanticRef[] | undefined;
}

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

export type KnowledgeType = "entity" | "action" | "topic" | "tag";
export type Knowledge =
    | conversation.ConcreteEntity
    | conversation.Action
    | ITopic
    | ITag;

export interface SemanticRef {
    semanticRefIndex: SemanticRefIndex;
    range: TextRange;
    knowledgeType: KnowledgeType;
    knowledge: Knowledge;
}

export interface ITopic {
    text: string;
}

export type ITag = ITopic;

export interface IConversation<TMeta extends IKnowledgeSource = any> {
    nameTag: string;
    tags: string[];
    messages: IMessage<TMeta>[];
    semanticRefs: SemanticRef[] | undefined;
    semanticRefIndex?: ITermToSemanticRefIndex | undefined;
    propertyToSemanticRefIndex: IPropertyToSemanticRefIndex | undefined;
    relatedTermsIndex?: ITermToRelatedTermsIndex | undefined;
    timestampIndex?: ITimestampToTextRangeIndex | undefined;
}

export type MessageIndex = number;

export interface TextLocation {
    // the index of the message
    messageIndex: MessageIndex;
    // the index of the chunk
    chunkIndex?: number;
    // the index of the character within the chunk
    charIndex?: number;
}

// a text range within a session
export interface TextRange {
    // the start of the range
    start: TextLocation;
    // the end of the range (exclusive)
    end?: TextLocation | undefined;
}

export interface IConversationData<TMessage> {
    nameTag: string;
    messages: TMessage[];
    tags: string[];
    semanticRefs: SemanticRef[];
    semanticIndexData?: ITermToSemanticRefIndexData | undefined;
    relatedTermsIndexData?: ITermsToRelatedTermsIndexData | undefined;
}

export type Term = {
    text: string;
    /**
     * Optional additional score to use when this term matches
     */
    score?: number | undefined;
};

export interface ITermToRelatedTermsIndex {
    lookupTerm(termText: string): Term[] | undefined;
    lookupTermFuzzy(termText: string): Promise<Term[] | undefined>;
    serialize(): ITermsToRelatedTermsIndexData;
    deserialize(data?: ITermsToRelatedTermsIndexData): void;
}

export interface ITermsToRelatedTermsIndexData {
    relatedTermsData?: ITermToRelatedTermsData | undefined;
    textEmbeddingData?: ITextEmbeddingIndexData | undefined;
}

export interface ITermToRelatedTermsData {
    relatedTerms?: ITermsToRelatedTermsDataItem[] | undefined;
}

export interface ITermsToRelatedTermsDataItem {
    termText: string;
    relatedTerms: Term[];
}

export interface ITermEmbeddingIndex {
    lookupTermsFuzzy(
        term: string,
        maxMatches?: number,
        minScore?: number,
    ): Promise<Term[] | undefined>;
    serialize(): ITextEmbeddingIndexData;
    deserialize(data: ITextEmbeddingIndexData): void;
}

export interface ITextEmbeddingIndexData {
    modelName?: string | undefined;
    embeddingData?: ITextEmbeddingDataItem[] | undefined;
}

export interface ITextEmbeddingDataItem {
    text: string;
    embedding: number[];
}

export type DateRange = {
    start: Date;
    end?: Date | undefined;
};

export type TimestampedTextRange = {
    timestamp: string;
    range: TextRange;
};

export interface ITimestampToTextRangeIndex {
    lookupRange(dateRange: DateRange): TimestampedTextRange[];
}
