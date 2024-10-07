// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DateTimeRange } from "./dateTimeSchema.js";

/* 
 Conversation memory is a sequence of messages between one or more users/speakers and assistants.
 The message sequence, and any entities, actions and topics in each message are indexed.
 */

// Search indexes for following search terms: typically single word keywords.
export type TermFilter = {
    terms: Term[];
    actionTerms?: ActionTerms[];
    // Use only if request explicitly asks for time range
    timeRange?: DateTimeRange | undefined; // in this time range
};

// Terms are one of the following:
// Entity Terms:
// - the name of an entity or thing such as "Bach", "Great Gatsby", "frog" or "piano"
// - the *type* of the entity such as "speaker", "person", "artist", "animal", "object", "instrument", "school", "room", "museum", "food" etc.
//   An entity can have multiple types; entity types should be single words
// - facets: specific, inherent, defining, or non-immediate facet of an entity such as "blue", "old", "famous", "sister", "aunt_of", "weight: 4 kg"
// Topic terms:
export type Term = string;

// Actions to search for
export type ActionTerms = {
    verb: string; // action verb
    subject?: string | undefined;
    object?: string | undefined;
    indirectObject?: string | undefined;
};

export type GetAnswerWithTermsAction = {
    actionName: "getAnswer";
    parameters: {
        filters: TermFilter[];
    };
};

export type UnknownSearchAction = {
    actionName: "unknown";
};

export type SearchTermsAction = GetAnswerWithTermsAction | UnknownSearchAction;
