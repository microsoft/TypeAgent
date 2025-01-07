// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DateTimeRange } from "./dateTimeSchema.js";

/* 
 Conversation memory is a sequence of messages between one or more users/speakers and assistants.
 The message sequence, and any entities, actions and topics in each message are indexed.
 */

// Search terms are one of the following:
// Entity Terms:
// - the name of an entity or thing such as "Bach", "Great Gatsby", "frog" or "piano"
// - the *type* of the entity such as "speaker", "person", "artist", "animal", "object", "instrument", "school", "room", "museum", "food" etc.
//   An entity can have multiple types; entity types should be single words
// - facets: specific, inherent, defining, or non-immediate facet of an entity such as "blue", "old", "famous", "sister", "aunt_of", "weight: 4 kg"
// Topics Terms:
// - topic or subject of conversation
export type SearchTerm = string;

export type VerbsTerm = {
    words: string[]; // individual words in single or compound verb
    verbTense: "past" | "present" | "future";
};

export type SubjectTerm = {
    subject: string;
    // true only if subject is a pronoun, such as "I", "Me", "Us", "They"
    isPronoun: boolean;
};

// Action Terms:
// - when user is querying an action
// - verb, subject, object and indirectObject associated with the verb
export type ActionTerm = {
    verbs?: VerbsTerm | undefined; // action verbs
    // The name of the entity that 'performs' the action. (e.g. email sender).
    subject: SubjectTerm | "none";
    object?: string | undefined; // 'receives' the action (e.g. 'email' in: What did X say in his email about Y the sent to Z')
};

// Search indexes for following search terms: typically single word keywords.
export type TermFilterV2 = {
    action?: ActionTerm;
    // searchTerms:
    // - do not repeat search terms already specified as an ActionTerm
    // - Remove generic terms like "topic/s", "subject", "discussion" etc
    // - Phrases like 'email address' or 'first name' are a single term
    // - use empty searchTerms array when use asks for summaries
    searchTerms?: SearchTerm[];
    // Use only if request explicitly asks for time range, particular year, month etc.
    timeRange?: DateTimeRange | undefined; // in this time range
};

export type GetAnswerWithTermsActionV2 = {
    actionName: "getAnswer";
    parameters: {
        // User question, rewritten to incorporate all context.
        question: string;
        // the question above is translated into filters. All words must be exactly as in the question
        filters: TermFilterV2[];
        summarize?: boolean | undefined;
    };
};

export type UnknownSearchActionV2 = {
    actionName: "unknown";
};

export type SearchTermsActionV2 =
    | GetAnswerWithTermsActionV2
    | UnknownSearchActionV2;
