// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";

// an object that can provide a KnowledgeResponse structure
export interface IKnowledgeSource {
    getKnowledge(): kpLib.KnowledgeResponse;
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

export type KnowledgeType = "entity" | "action" | "topic" | "tag";
export type Knowledge = kpLib.ConcreteEntity | kpLib.Action | Topic | Tag;

export interface SemanticRef {
    semanticRefIndex: SemanticRefIndex;
    range: TextRange;
    knowledgeType: KnowledgeType;
    knowledge: Knowledge;
}

export interface Topic {
    text: string;
}

export interface Tag {
    text: string;
}

export interface IConversation<TMeta extends IKnowledgeSource = any> {
    nameTag: string;
    tags: string[];
    messages: IMessage<TMeta>[];
    semanticRefs: SemanticRef[] | undefined;
    semanticRefIndex?: ITermToSemanticRefIndex | undefined;
    secondaryIndexes?: IConversationSecondaryIndexes | undefined;
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
    // the end of the range  (exclusive)
    end?: TextLocation | undefined;
}

export type DateRange = {
    start: Date;
    // Inclusive
    end?: Date | undefined;
};

export type Term = {
    text: string;
    /**
     * Optional weighting for these matches
     */
    weight?: number | undefined;
};

export type ScoredKnowledge = {
    knowledgeType: KnowledgeType;
    knowledge: Knowledge;
    score: number;
};

export interface IConversationSecondaryIndexes {
    propertyToSemanticRefIndex?: IPropertyToSemanticRefIndex | undefined;
    timestampIndex?: ITimestampToTextRangeIndex | undefined;
    termToRelatedTermsIndex?: ITermToRelatedTermsIndex | undefined;
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
    addTimestamps(messageTimestamps: [MessageIndex, string][]): void;
    lookupRange(dateRange: DateRange): TimestampedTextRange[];
}

export interface ITermToRelatedTerms {
    lookupTerm(text: string): Term[] | undefined;
}

export interface ITermToRelatedTermsFuzzy {
    addTerms(
        terms: string[],
        eventHandler?: IndexingEventHandlers,
    ): Promise<void>;
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

export interface ITermToRelatedTermsIndex {
    get aliases(): ITermToRelatedTerms | undefined;
    get fuzzyIndex(): ITermToRelatedTermsFuzzy | undefined;
}

/**
 * A Thread is a set of text ranges in a conversation
 */
export type Thread = {
    description: string;
    ranges: TextRange[];
};

export type ThreadIndex = number;

export type ScoredThreadIndex = {
    threadIndex: ThreadIndex;
    score: number;
};

export interface IConversationThreads {
    readonly threads: Thread[];

    addThread(thread: Thread): Promise<void>;
    lookupThread(
        threadDescription: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredThreadIndex[] | undefined>;
    removeThread(threadIndex: ThreadIndex): void;
}

//------------------------
// Serialization formats
//------------------------

export interface IConversationData<TMessage = any> {
    nameTag: string;
    messages: TMessage[];
    tags: string[];
    semanticRefs: SemanticRef[];
    semanticIndexData?: ITermToSemanticRefIndexData | undefined;
}

// persistent form of a term index
export interface ITermToSemanticRefIndexData {
    items: ITermToSemanticRefIndexItem[];
}

export interface ITermToSemanticRefIndexItem {
    term: string;
    semanticRefIndices: ScoredSemanticRef[];
}

//------------------------
// Indexing
//------------------------

export interface IndexingEventHandlers {
    onKnowledgeExtracted?: (
        chunk: TextLocation,
        knowledgeResult: kpLib.KnowledgeResponse,
    ) => boolean;
    onEmbeddingsCreated?: (
        sourceTexts: string[],
        batch: string[],
        batchStartAt: number,
    ) => boolean;
}
export type IndexingResults = {
    chunksIndexedUpto?: TextLocation | undefined;
    error?: string | undefined;
};
