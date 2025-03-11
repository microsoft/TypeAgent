// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";

// an object that can provide a KnowledgeResponse structure
export interface IKnowledgeSource {
    getKnowledge(): kpLib.KnowledgeResponse;
}

export type MessageIndex = number;

export interface IMessage extends IKnowledgeSource {
    // the text of the message, split into chunks
    textChunks: string[];
    timestamp?: string | undefined;
    tags: string[];
    deletionInfo?: DeletionInfo;
}

export interface IMessageMetadata<TMeta = any> {
    metadata: TMeta;
}

export type ScoredMessageIndex = {
    messageIndex: MessageIndex;
    score: number;
};

export interface DeletionInfo {
    timestamp: string;
    reason?: string;
}

export type KnowledgeType = "entity" | "action" | "topic" | "tag";
export type Knowledge = kpLib.ConcreteEntity | kpLib.Action | Topic | Tag;

export type SemanticRefIndex = number;

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

export interface IConversation<TMessage extends IKnowledgeSource = any> {
    nameTag: string;
    tags: string[];
    messages: TMessage[];
    semanticRefs: SemanticRef[] | undefined;
    semanticRefIndex?: ITermToSemanticRefIndex | undefined;
    secondaryIndexes?: IConversationSecondaryIndexes | undefined;
}

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
    messageIndex?: IMessageTextIndex | undefined;
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
    addTimestamps(
        messageTimestamps: [MessageIndex, string][],
    ): ListIndexingResult;
    lookupRange(dateRange: DateRange): TimestampedTextRange[];
}

export interface ITermToRelatedTerms {
    lookupTerm(text: string): Term[] | undefined;
}

export interface ITermToRelatedTermsFuzzy {
    addTerms(
        terms: string[],
        eventHandler?: IndexingEventHandlers,
    ): Promise<ListIndexingResult>;
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

export interface IMessageTextIndex {
    addMessages(
        messages: IMessage[],
        eventHandler?: IndexingEventHandlers,
    ): Promise<ListIndexingResult>;
    lookupMessages(
        messageText: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredMessageIndex[]>;
    lookupMessagesInSubset(
        messageText: string,
        indicesToSearch: MessageIndex[],
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredMessageIndex[]>;
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
// Indexing events and results
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
    onTextIndexed?: (
        textAndLocations: [string, TextLocation][],
        batch: [string, TextLocation][],
        batchStartAt: number,
    ) => boolean;
}

export type IndexingResults = {
    semanticRefs?: TextIndexingResult | undefined;
    secondaryIndexResults?: SecondaryIndexingResults | undefined;
};

export type SecondaryIndexingResults = {
    properties?: ListIndexingResult | undefined;
    timestamps?: ListIndexingResult | undefined;
    relatedTerms?: ListIndexingResult | undefined;
    message?: TextIndexingResult | undefined;
};

export type TextIndexingResult = {
    completedUpto?: TextLocation | undefined;
    error?: string | undefined;
};

export type ListIndexingResult = {
    numberCompleted: number;
    error?: string | undefined;
};
