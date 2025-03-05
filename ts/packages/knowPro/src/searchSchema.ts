// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DateTimeRange } from "./dateTimeSchema.js";

export type FacetTerm = {
    name: string;
    // Very concise values.
    value: string;
};

// Specific, tangible people, places, institutions or things only
// Abstract concepts or topics are not entityTerms. Use SearchTerm for them
// Any terms will match fuzzily.
export type EntityTerm = {
    // the name of the entity or thing such as "Bach", "Great Gatsby", "frog" or "piano"
    name: string;
    // the types of the entity such as "speaker", "person", "artist", "animal", "object", "instrument", "school", "room", "museum", "food" etc.
    // An entity can have multiple types; entity types should be single words
    type: string[];
    // A specific, inherent, defining, or non-immediate facet of the entity such as "blue", "old", "famous", "sister", "aunt_of", "weight: 4 kg"
    // trivial actions or state changes are not facets
    // facets are concise "properties"
    facets?: FacetTerm[];
};

export type VerbsTerm = {
    words: string[]; // individual words in single or compound verb
};

export type SourceTerm = {
    text: string;
    // true only if subject is a pronoun, such as "I", "Me", "Us", "They"
    isPronoun: boolean;
};

// ActionTerm
// - "from" refers to the origin of the action or information, typically the entity performing the action
// - "to" refers to the recipient or target of the action or information
export type ActionTerm = {
    verbs?: VerbsTerm | undefined; // action verbs
    from: SourceTerm | "none";
    to?: SourceTerm | undefined;
};

// Search indexes for following search terms: typically single word keywords.
export type SearchFilter = {
    action?: ActionTerm;
    entities?: EntityTerm[];
    // searchTerms:
    // Concepts, topics or other terms that don't fit ActionTerms or EntityTerms
    // - Remove generic terms like "topic/s", "subject", "discussion" etc
    // - Phrases like 'email address' or 'first name' are a single term
    // - use empty searchTerms array when use asks for summaries
    searchTerms?: string[];
    // Use only if request explicitly asks for time range, particular year, month etc.
    timeRange?: DateTimeRange | undefined; // in this time range
};
