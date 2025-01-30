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
        semanticRefIndex: SemanticRefIndex,
        strength?: number,
    ): void;
    removeTerm(term: string, semanticRefIndex: SemanticRefIndex): void;
    lookupTerm(term: string): ScoredSemanticRef[] | undefined;
}

export type KnowledgeType = "entity" | "action" | "topic" | "tag";

export interface SemanticRef {
    semanticRefIndex: SemanticRefIndex;
    range: TextRange;
    knowledgeType: KnowledgeType;
    knowledge:
        | conversation.ConcreteEntity
        | conversation.Action
        | ITopic
        | ITag;
}

export interface ITopic {
    text: string;
}

export type ITag = ITopic;

export interface IConversation<TMeta extends IKnowledgeSource = any> {
    nameTag: string;
    tags: string[];
    messages: IMessage<TMeta>[];
    semanticRefIndex?: ITermToSemanticRefIndex | undefined;
    semanticRefs: SemanticRef[] | undefined;
    relatedTermsIndex?: ITermToRelatedTermsIndex | undefined;
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
}

export type Term = {
    text: string;
    /**
     * Optional additional score to use when this term matches
     */
    score?: number | undefined;
};

export type QueryTerm = {
    term: Term;
    /**
     * These can be supplied from fuzzy synonym tables and so on
     */
    relatedTerms?: Term[] | undefined;
};

export interface ITermToRelatedTermsIndex {
    lookupTerm(term: string): Promise<Term[] | undefined>;
}

export interface ITextSemanticIndex {
    serialize(): ITextEmbeddingData;
    deserialize(data: ITextEmbeddingData): void;
}

export interface ITextEmbeddingData {
    embeddingData?: ITextEmbeddingDataItem[] | undefined;
}

export interface ITextEmbeddingDataItem {
    text: string;
    embedding: number[];
}
