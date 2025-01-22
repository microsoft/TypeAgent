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
    addTerm(
        term: string,
        semanticRefIndex: SemanticRefIndex,
        strength?: number,
    ): void;
    removeTerm(term: string, semanticRefIndex: SemanticRefIndex): void;
    lookupTerm(
        term: string,
        fuzzy?: boolean | undefined,
    ): ScoredSemanticRef[] | undefined;
}

export interface SemanticRef {
    range: TextRange;
    knowledgeType: "entity" | "action" | "topic" | "tag";
    knowledge:
        | conversation.ConcreteEntity
        | conversation.Action
        | ITopic
        | ITag;
}

export interface ITopic {
    text: string;
}

type ITag = ITopic;

export interface IConversation<TMeta extends IKnowledgeSource> {
    nameTag: string;
    tags: string[];
    messages: IMessage<TMeta>[];
    // this should be defined before persisting the conversation
    semanticRefData?: ITermToSemanticRefIndexData;

    // this should be undefined before persisting the conversation
    semanticRefIndex?: ITermToSemanticRefIndex | undefined;
    // this should be defined before persisting the conversation
    semanticRefs: SemanticRef[] | undefined;
}

export interface TextLocation {
    // the index of the message
    messageIndex: number;
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
