// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";

// an object that can provide a KnowledgeResponse structure
export interface IKnowledgeSource {
    getKnowledge: () => kpLib.KnowledgeResponse;
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

    serialize(): Promise<IConversationData<IMessage<TMeta>>>;
    deserialize(data: IConversationData<IMessage<TMeta>>): Promise<void>;
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

export interface IConversationData<TMessage = any> {
    nameTag: string;
    messages: TMessage[];
    tags: string[];
    semanticRefs: SemanticRef[];
    semanticIndexData?: ITermToSemanticRefIndexData | undefined;
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

export interface IConversationIndexes {
    semanticRefIndex?: ITermToSemanticRefIndex | undefined;
    propertyToSemanticRefIndex?: IPropertyToSemanticRefIndex | undefined;
    timestampIndex?: ITimestampToTextRangeIndex | undefined;
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

export interface ITermToRelatedTermsIndex {
    get aliases(): ITermToRelatedTerms | undefined;
    get fuzzyIndex(): ITermToRelatedTermsFuzzy | undefined;
}
