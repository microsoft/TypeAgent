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
    termToRelatedTermsIndex?: ITermToRelatedTermsIndex | undefined;
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
     * Optional weighting for these matches
     */
    weight?: number | undefined;
};

export interface ITermToRelatedTermsIndex {
    get aliases(): ITermToRelatedTerms | undefined;
    get termEditDistanceIndex(): ITermToRelatedTermsFuzzy | undefined;
    get termVectorIndex(): ITermToRelatedTermsFuzzy | undefined;
    serialize(): ITermsToRelatedTermsIndexData;
    deserialize(data?: ITermsToRelatedTermsIndexData): void;
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
