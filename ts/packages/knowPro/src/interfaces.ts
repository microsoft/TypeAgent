// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";

/**
 * A Knowledge Source is any object that returns knowledge
 * Knowledge is returned in the form of a KnowledgeResponse {@link kpLib.KnowledgeResponse}
 */
export interface IKnowledgeSource {
    /**
     * Retrieves knowledge from the source.
     * @returns {kpLib.KnowledgeResponse | undefined} The knowledge response or undefined if no knowledge is available.
     */
    getKnowledge(): kpLib.KnowledgeResponse | undefined;
}

/**
 * Messages are referenced by their sequential ordinal numbers
 */
export type MessageOrdinal = number;

/**
 * Metadata associated with a message.
 */
export interface IMessageMetadata {
    /**
     * The source ("sender/s") of the message
     */
    readonly source?: string | string[] | undefined;
    /**
     * The dest ("recipients") of the message
     */
    readonly dest?: string | string[] | undefined;
}

/**
 * A message in a conversation
 * A Message contains one or more text chunks
 */
export interface IMessage extends IKnowledgeSource {
    /**
     * The text of the message, split into chunks
     */
    textChunks: string[];
    /**
     * The (optional) timestamp of the message.
     */
    timestamp?: string | undefined;
    /**
     * (Optional) tags associated with the message
     */
    tags: string[];
    /**
     * (Future) Information about the deletion of the message.
     */
    deletionInfo?: DeletionInfo | undefined;
    /**
     * Metadata associated with the message such as its source.
     */
    metadata?: IMessageMetadata | undefined;
}

/**
 * Represents a message ordinal with an associated score.
 */
export type ScoredMessageOrdinal = {
    /**
     * The ordinal number of the message.
     */
    messageOrdinal: MessageOrdinal;
    /**
     * The score associated with the message.
     */
    score: number;
};

/**
 * (Future)
 */
export interface DeletionInfo {
    timestamp: string;
    reason?: string;
}

/**
 * Types of knowledge objects {@link Knowledge}
 */
export type KnowledgeType = "entity" | "action" | "topic" | "tag";
/**
 * Knowledge objects
 */
export type Knowledge = kpLib.ConcreteEntity | kpLib.Action | Topic | Tag;

/**
 * Semantic Refs are referenced by their sequential ordinal numbers
 */
export type SemanticRefOrdinal = number;

/**
 * A semantic reference represents semantic knowledge that was extracted
 * from a source text range
 */
export interface SemanticRef {
    semanticRefOrdinal: SemanticRefOrdinal;
    /**
     * Range of text where this semantic reference was found/extracted.
     */
    range: TextRange;
    /**
     * Type of knowledge the reference points to.
     */
    knowledgeType: KnowledgeType;
    /**
     * The actual knowledge object.
     */
    knowledge: Knowledge;
}

/**
 * Knowledge of type "topic"
 */
export interface Topic {
    /**
     * Text of the topic.
     */
    text: string;
}

/**
 * Tags
 */
export interface Tag {
    /**
     * Text of the tag.
     */
    text: string;
}

/**
 * A conversation is a sequence of messages
 * The conversation can also store semantic refs {@link SemanticRef} that was found
 * in the source text of the messages.
 *
 * Messages and semantic refs are indexed for retrieval.
 *
 * @template TMessage - Type of the message in the conversation.
 */
export interface IConversation<TMessage extends IMessage = IMessage> {
    /**
     * Name tag for the conversation.
     */
    nameTag: string;
    /**
     * Array of tags associated with the conversation.
     */
    tags: string[];
    /**
     * Collection of messages in the conversation.
     */
    messages: IMessageCollection<TMessage>;
    /**
     * Collection of semantic references, if any.
     */
    semanticRefs: ISemanticRefCollection | undefined;
    /**
     * Index mapping terms to semantic references.
     */
    semanticRefIndex?: ITermToSemanticRefIndex | undefined;
    /**
     * Secondary indexes for the conversation.
     */
    secondaryIndexes?: IConversationSecondaryIndexes | undefined;
}

/**
 * Represents a scored semantic reference ordinal.
 */
export type ScoredSemanticRefOrdinal = {
    /**
     * Ordinal number for the semantic reference.
     */
    semanticRefOrdinal: SemanticRefOrdinal;
    /**
     * Score associated with the semantic reference.
     */
    score: number;
};

/**
 * Inverted Index from term to Semantic Refs {@link SemanticRef}
 */
export interface ITermToSemanticRefIndex {
    /**
     * Retrieves all terms in the index.
     *
     * @returns An array of terms.
     */
    getTerms(): string[];
    /**
     * Adds a term with its associated semantic reference ordinal.
     *
     * @param term - The term to add.
     * @param semanticRefOrdinal - The semantic reference ordinal or scored semantic reference ordinal.
     * @returns The added term.
     */
    addTerm(
        term: string,
        semanticRefOrdinal: SemanticRefOrdinal | ScoredSemanticRefOrdinal,
    ): string;
    /**
     * Removes a term with its associated semantic reference ordinal.
     *
     * @param term - The term to remove.
     * @param semanticRefOrdinal - The semantic reference ordinal.
     */
    removeTerm(term: string, semanticRefOrdinal: SemanticRefOrdinal): void;
    /**
     * Looks up a term and retrieves its associated scored semantic reference ordinals.
     *
     * @param term - The term to look up.
     * @returns An array of scored semantic reference ordinals or undefined if the term is not found.
     */
    lookupTerm(term: string): ScoredSemanticRefOrdinal[] | undefined;
}

/**
 * Represents a specific location of within a text {@link IMessage}.
 * A message can contain one or more text chunks
 */
export interface TextLocation {
    /**
     * The ordinal of the message.
     */
    messageOrdinal: MessageOrdinal;

    /**
     * [Optional] The ordinal index of the chunk within the message.
     */
    chunkOrdinal?: number;

    /**
     * [Optional] The ordinal index of the character within the chunk.
     */
    charOrdinal?: number;
}

/**
 * A text range within a conversation
 * TextRange can represent both a text range and a point location
 * If 'end' is undefined, the text range represents a point location, identified by 'start'
 */
export interface TextRange {
    /**
     * The start of the range.
     */
    start: TextLocation;
    /**
     * The (optional) end of the range (exclusive).
     */
    end?: TextLocation | undefined;
}

/**
 * Represents a date range.
 */
export type DateRange = {
    /**
     * The start date of the range (inclusive).
     */
    start: Date;
    /**
     * The (optional) end date of the range (inclusive).
     */
    end?: Date | undefined;
};

/**
 * Represents a term with optional weighting.
 */
export type Term = {
    /**
     * The text of the term.
     */
    text: string;
    /**
     * Optional weighting for any matches for this term
     */
    weight?: number | undefined;
};

/**
 * Represents scored knowledge.
 * Scored knowledge is typically returned by search APIs
 */
export type ScoredKnowledge = {
    /**
     * Type of knowledge.
     */
    knowledgeType: KnowledgeType;
    /**
     * The actual knowledge object.
     */
    knowledge: Knowledge;
    /**
     * Score associated with the knowledge.
     */
    score: number;
};

/**
 * Interface for conversation secondary indexes.
 * {@link IConversation}
 */
export interface IConversationSecondaryIndexes {
    /**
     * Index mapping properties to semantic references.
     */
    propertyToSemanticRefIndex?: IPropertyToSemanticRefIndex | undefined;
    /**
     * Index mapping timestamps to text ranges.
     */
    timestampIndex?: ITimestampToTextRangeIndex | undefined;
    /**
     * Index mapping terms to related terms.
     */
    termToRelatedTermsIndex?: ITermToRelatedTermsIndex | undefined;
    /**
     * Optional threads in the conversation.
     */
    threads?: IConversationThreads | undefined;
    /**
     * Optional index for message text.
     */
    messageIndex?: IMessageTextIndex | undefined;
}

/**
 * Allows for faster retrieval of name, value properties
 */
export interface IPropertyToSemanticRefIndex {
    /**
     * All property values
     */
    getValues(): string[];
    /**
     * Adds a property name, value and the ordinal of the semantic ref this
     * property was found in (associated with)
     *
     * @param propertyName - The name of the property.
     * @param value - The value of the property.
     * @param semanticRefOrdinal - The semantic reference ordinal or scored semantic reference ordinal.
     */
    addProperty(
        propertyName: string,
        value: string,
        semanticRefOrdinal: SemanticRefOrdinal | ScoredSemanticRefOrdinal,
    ): void;
    /**
     * Looks up a property (name, value) returning the associated scored semantic reference ordinals.
     *
     * @param propertyName - The name of the property.
     * @param value - The value of the property.
     * @returns An array of scored semantic reference ordinals or undefined if the property is not found.
     */
    lookupProperty(
        propertyName: string,
        value: string,
    ): ScoredSemanticRefOrdinal[] | undefined;
}

/**
 * Represents a timestamped text range.
 */
export type TimestampedTextRange = {
    /**
     * The timestamp associated with the text range.
     */
    timestamp: string;
    /**
     * The text range.
     */
    range: TextRange;
};

/**
 * Interface for timestamp to text range index.
 * Allows for retrieval of text ranges within a given date range.
 */
export interface ITimestampToTextRangeIndex {
    /**
     * Adds a message ordinal with the given timestamp
     * The message ordinal represents a {@link TextLocation} {messageOrdinal}
     * @param messageOrdinal - The ordinal of the message.
     * @param timestamp - The timestamp to add.
     * @returns True if the timestamp was added successfully, false otherwise.
     */
    addTimestamp(messageOrdinal: MessageOrdinal, timestamp: string): boolean;
    /**
     * Add multiple {messageOrdinal, timestamp} pairs
     * @param messageTimestamps
     */
    addTimestamps(
        messageTimestamps: [MessageOrdinal, string][],
    ): ListIndexingResult;
    /**
     * Looks up text ranges within a given date range.
     *
     * @param dateRange - The date range to look up.
     * @returns An array of timestamped text ranges.
     */
    lookupRange(dateRange: DateRange): TimestampedTextRange[];
}

/**
 * Returns related terms for a given term
 * This is ideal for local synonym and other tables
 */
export interface ITermToRelatedTerms {
    /**
     * Lookup terms related to the given term text
     * @param text
     */
    lookupTerm(text: string): Term[] | undefined;
}

/**
 * An index that maintains fuzzy (approximate) relationships between terms
 * The fuzzy relationship may be determined dynamically
 * Given a term, can return terms approximately related to it.
 */
export interface ITermToRelatedTermsFuzzy {
    /**
     * Add a term to the index.
     * @param terms
     * @param eventHandler
     */
    addTerms(
        terms: string[],
        eventHandler?: IndexingEventHandlers,
    ): Promise<ListIndexingResult>;
    /**
     * Looks up a term and retrieves related terms
     *
     * @param text - The text of the term to look up.
     * @param maxMatches - Optional maximum number of matches to retrieve.
     * @param thresholdScore - Optional threshold similarity score for matches.
     * @returns A promise that resolves to an array of related terms.
     */
    lookupTerm(
        text: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<Term[]>;
    /**
     * Looks up terms in a batch
     * @param textArray
     * @param maxMatches
     * @param thresholdScore
     */
    lookupTerms(
        textArray: string[],
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<Term[][]>;
}

/**
 * Interface for term to related terms index.
 */
export interface ITermToRelatedTermsIndex {
    /**
     * Return the alias index, if available
     */
    get aliases(): ITermToRelatedTerms | undefined;
    /**
     * Return a fuzzy index, if available
     */
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
export interface SearchTerm {
    /**
     * Term being searched for
     */
    term: Term;
    /**
     * Additional terms related to term.
     * These can be supplied from synonym tables and so on.
     *  - Zero length array: no related matches for this term. That will force an exact match
     *  - undefined array: the search processor may try to resolve related terms from any  {@link IConversationSecondaryIndexes}
     * related term {@link ITermToRelatedTermsIndex} indexes available to it
     */
    relatedTerms?: Term[] | undefined;
}

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
    | "tag" // Tag
    | "topic";

export type PropertySearchTerm = {
    /**
     * PropertySearch terms let you match named property, values
     * - You can  match a well known property name (name("Bach") type("book"))
     * - Or you can provide a SearchTerm as a propertyName.
     *   E.g. to match hue(red)
     *      - propertyName as SearchTerm, set to 'hue'
     *      - propertyValue as SearchTerm, set to 'red'
     *    We also want hue(red) to match any facets called color(red)
     * SearchTerms can included related terms
     *   E.g you could include "color" as a related term for the propertyName "hue". Or 'crimson' for red.
     *
     * See {@link KnowledgePropertyName} for well known property names
     *
     * The the query processor can also related terms using a related terms secondary index, if one is available
     */
    propertyName: KnowledgePropertyName | SearchTerm;
    propertyValue: SearchTerm;
};

/**
 * Terms in a SearchTermGroup can of these types
 */
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

/**
 * An expression used to select contents structured contents of the conversation
 */
export type SearchSelectExpr = {
    /**
     * A Term group that matches information
     */
    searchTermGroup: SearchTermGroup;
    /**
     * A filter that scopes what information to match
     */
    when?: WhenFilter | undefined;
};

/**
 * A WhenFilter provides additional constraints on when a SemanticRef that matches a term.. is actually considered a match
 * when the following optional conditions are met:
 *   knowledgeType matches. E.g. knowledgeType == 'entity'
 *   dateRange matches...E.g. (Jan 3rd to Jan 10th)
 *   Semantic Refs are within supplied SCOPE.. i.e. only Semantic Refs from a 'scoping' set of text ranges will match
 */
export type WhenFilter = {
    /**
     * Match SemanticRefs of this knowledge type
     */
    knowledgeType?: KnowledgeType | undefined;
    /**
     * Match only in this date range
     */
    dateRange?: DateRange | undefined;
    /**
     * If a thread index is available, match in a thread closest to ths description
     */
    threadDescription?: string | undefined;

    tags?: string[] | undefined;
    /**
     * Use this SearchTermGroup as a sub-query to find matching text ranges
     * Match SemanticRefs the scope for this query
     */
    scopeDefiningTerms?: SearchTermGroup | undefined;
    /**
     * Additional scoping ranges separately computed by caller
     */
    textRangesInScope?: TextRange[] | undefined;
};

export type SemanticRefSearchResult = {
    termMatches: Set<string>;
    semanticRefMatches: ScoredSemanticRefOrdinal[];
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
export interface IReadonlyCollection<T, TOrdinal = number> extends Iterable<T> {
    readonly length: number;
    get(ordinal: TOrdinal): T;
    getMultiple(ordinals: TOrdinal[]): T[];
    getSlice(start: TOrdinal, end: TOrdinal): T[];
}

/**
 * ICollection is an APPEND ONLY collection
 */
export interface ICollection<T, TOrdinal = number>
    extends IReadonlyCollection<T, TOrdinal> {
    readonly isPersistent: boolean;

    append(...items: T[]): void;
}

export interface IMessageCollection<TMessage extends IMessage = IMessage>
    extends ICollection<TMessage, MessageOrdinal> {}

export interface ISemanticRefCollection
    extends ICollection<SemanticRef, SemanticRefOrdinal> {}

export interface IStorageProvider {
    createMessageCollection<TMessage extends IMessage = IMessage>(
        serializer?: JsonSerializer<TMessage>,
    ): IMessageCollection<TMessage>;
    createSemanticRefCollection(): ISemanticRefCollection;
    close(): void;
}

export interface JsonSerializer<T> {
    serialize(value: T): string;
    deserialize(json: string): T;
}

// Also look at:
// search.ts
// searchQueryTranslator.ts
