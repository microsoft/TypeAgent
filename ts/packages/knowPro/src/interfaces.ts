// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";

// an object that can provide a KnowledgeResponse structure
export interface IKnowledgeSource {
    getKnowledge(): kpLib.KnowledgeResponse | undefined;
}

export type MessageOrdinal = number;

/**
 * A message in a conversation
 * A Message contains one or more text chunks
 */
export interface IMessage extends IKnowledgeSource {
    // the text of the message, split into chunks
    textChunks: string[];
    timestamp?: string | undefined;
    tags: string[];
    deletionInfo?: DeletionInfo | undefined;
}

export type ScoredMessageOrdinal = {
    messageOrdinal: MessageOrdinal;
    score: number;
};

export interface DeletionInfo {
    timestamp: string;
    reason?: string;
}

export type KnowledgeType = "entity" | "action" | "topic" | "tag";
export type Knowledge = kpLib.ConcreteEntity | kpLib.Action | Topic | Tag;

export type SemanticRefOrdinal = number;

export interface SemanticRef {
    semanticRefOrdinal: SemanticRefOrdinal;
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

export interface IConversation<TMessage extends IMessage = IMessage> {
    nameTag: string;
    tags: string[];
    messages: TMessage[];
    //messages: IMessageCollection<TMessage>;
    semanticRefs: SemanticRef[] | undefined;
    semanticRefIndex?: ITermToSemanticRefIndex | undefined;
    secondaryIndexes?: IConversationSecondaryIndexes | undefined;
}

export type ScoredSemanticRefOrdinal = {
    semanticRefOrdinal: SemanticRefOrdinal;
    score: number;
};

export interface ITermToSemanticRefIndex {
    getTerms(): string[];
    addTerm(
        term: string,
        semanticRefOrdinal: SemanticRefOrdinal | ScoredSemanticRefOrdinal,
    ): void;
    removeTerm(term: string, semanticRefOrdinal: SemanticRefOrdinal): void;
    lookupTerm(term: string): ScoredSemanticRefOrdinal[] | undefined;
}

/**
 * Represents a specific location of within a text {@link IMessage}.
 * A message can contain one or more text chunks
 */
export interface TextLocation {
    // the ordinal of the message
    messageOrdinal: MessageOrdinal;

    // [Optional] The ordinal index of the chunk within the message.
    chunkOrdinal?: number;

    // [Optional] The ordinal index of the character within the chunk.
    charOrdinal?: number;
}

/**
 * A text range within a conversation
 * TextRange can represent both a text range and a point location
 * If 'end' is undefined, the text range represents a point location, identified by 'start'
 */
export interface TextRange {
    // the start of the range
    start: TextLocation;
    // the (optional)end of the range  (exclusive)
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
        semanticRefOrdinal: SemanticRefOrdinal | ScoredSemanticRefOrdinal,
    ): void;
    lookupProperty(
        propertyName: string,
        value: string,
    ): ScoredSemanticRefOrdinal[] | undefined;
}

export type TimestampedTextRange = {
    timestamp: string;
    range: TextRange;
};

/**
 * Return text ranges in the given date range
 */
export interface ITimestampToTextRangeIndex {
    addTimestamp(messageOrdinal: MessageOrdinal, timestamp: string): boolean;
    addTimestamps(
        messageTimestamps: [MessageOrdinal, string][],
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

export type ThreadOrdinal = number;

export type ScoredThreadOrdinal = {
    threadOrdinal: ThreadOrdinal;
    score: number;
};

export interface IConversationThreads {
    readonly threads: Thread[];

    addThread(thread: Thread): Promise<void>;
    lookupThread(
        threadDescription: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredThreadOrdinal[] | undefined>;
    removeThread(threadOrdinal: ThreadOrdinal): void;
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
    ): Promise<ScoredMessageOrdinal[]>;
    lookupMessagesInSubset(
        messageText: string,
        ordinalsToSearch: MessageOrdinal[],
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredMessageOrdinal[]>;
}

//------------------------
// Search Types
//------------------------
export type SearchTerm = {
    /**
     * Term being searched for
     */
    term: Term;
    /**
     * Additional terms related to term.
     * These can be supplied from synonym tables and so on.
     *  - Zero length array: no related matches for this term
     *  - undefined array: the search processor may try to resolve related terms from any  {@link IConversationSecondaryIndexes}
     * related term {@link ITermToRelatedTermsIndex} indexes available to it
     */
    relatedTerms?: Term[] | undefined;
};

/**
 * Well known knowledge properties
 */

export type KnowledgePropertyName =
    | "name" // the name of an entity
    | "type" // the type of an entity
    | "verb" // the verb of an action
    | "subject" // the subject of an action
    | "object" // the object of an action
    | "indirectObject" // The indirectObject of an action
    | "tag"; // Tag

export type PropertySearchTerm = {
    /**
     * PropertySearch terms let you matched named property, values
     * - You can  match a well known property name (name("Bach") type("book"))
     * - Or you can provide a SearchTerm as a propertyName.
     *   E.g. to match hue(red)
     *      - propertyName as SearchTerm, set to 'hue'
     *      - propertyValue as SearchTerm, set to 'red'
     *    We also want hue(red) to match any facets called color(red)
     * SearchTerms can included related terms
     *   E.g you could include "color" as a related term for the propertyName "hue". Or 'crimson' for red.
     * The the query processor can also related terms using a related terms secondary index, if one is available
     */
    propertyName: KnowledgePropertyName | SearchTerm;
    propertyValue: SearchTerm;
};

export type SearchTermGroupTypes =
    | SearchTerm
    | PropertySearchTerm
    | SearchTermGroup;

/**
 * A Group of search terms
 */
export type SearchTermGroup = {
    booleanOp:
        | "and" // Intersect matches for each term, adding up scores
        | "or" // Union matches for each term, adding up scores
        | "or_max"; // Union matches for each term, add up scores, select matches with max hit count

    terms: SearchTermGroupTypes[];
};

//------------------------
// Serialization formats
// TODO: Move to dataFormats.ts
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
    semanticRefOrdinals: ScoredSemanticRefOrdinal[];
}

//------------------------
// Indexing events and results
//------------------------

export interface IndexingEventHandlers {
    onKnowledgeExtracted?: (
        chunk: TextLocation,
        knowledgeResult: kpLib.KnowledgeResponse | kpLib.KnowledgeResponse[],
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
    message?: ListIndexingResult | undefined;
};

export type TextIndexingResult = {
    completedUpto?: TextLocation | undefined;
    error?: string | undefined;
};

export type ListIndexingResult = {
    numberCompleted: number;
    error?: string | undefined;
};

//---------------------
// Storage
//---------------------
export interface IReadonlyCollection<T, TOrdinal> extends Iterable<T> {
    readonly length: number;
    get(ordinal: TOrdinal): T;
    getMultiple(ordinals: TOrdinal[]): T[];
    getSlice(start: TOrdinal, end: TOrdinal): T[];
    getAll(): T[];
}

/**
 * ICollection is an APPEND ONLY collection
 */
export interface ICollection<T, TOrdinal>
    extends IReadonlyCollection<T, TOrdinal> {
    readonly isPersistent: boolean;

    append(...items: T[]): void;
}

export interface IMessageCollection<TMessage extends IMessage = IMessage>
    extends ICollection<TMessage, MessageOrdinal> {}

export interface ISemanticRefCollection
    extends ICollection<SemanticRef, SemanticRefOrdinal> {}

export interface IStorageProvider {
    createMessageCollection<
        TMessage extends IMessage = IMessage,
    >(): IMessageCollection<TMessage>;
    createSemanticRefCollection(): ISemanticRefCollection;
}

// Also look at:
// search.ts
// searchQueryTranslator.ts
