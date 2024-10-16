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
// - use empty term array for summaries
export type SearchTerm = string;

export type VerbsTerm = {
    verbs: string[];
    verbTense: "past" | "present" | "future";
};
// Action Terms:
// - when user is querying an action
// - verb, subject, object and indirectObject associated with the verb
export type ActionTerm = {
    verbs?: VerbsTerm | undefined; // action verbs
    // - subject and object for the verb
    subject?: string | undefined;
    object?: string | undefined;
};

// Search indexes for following search terms: typically single word keywords.
export type TermFilterV2 = {
    action?: ActionTerm;
    // do not include terms already in action
    searchTerms?: SearchTerm[];
    // Use only if request explicitly asks for time range
    timeRange?: DateTimeRange | undefined; // in this time range
};

export type GetAnswerWithTermsActionV2 = {
    actionName: "getAnswer";
    parameters: {
        filters: TermFilterV2[];
    };
};

export type UnknownSearchActionV2 = {
    actionName: "unknown";
};

export type SearchTermsActionV2 =
    | GetAnswerWithTermsActionV2
    | UnknownSearchActionV2;
