// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DateTimeRange } from "./dateTimeSchema.js";

/* 
 Conversation memory is a sequence of messages between one or more users/speakers and assistants.
 The message sequence, and any entities, actions and topics in each message are indexed.
 */

// Search indexes for following search terms: typically single word keywords.
export type TermFilterV2 = {
    // any verb terms to look for
    verbs?: VerbTermV2 | undefined;
    // Terms are one of the following:
    // Entity Terms:
    // - the name of an entity or thing such as "Bach", "Great Gatsby", "frog" or "piano"
    // - the *type* of the entity such as "speaker", "person", "artist", "animal", "object", "instrument", "school", "room", "museum", "food" etc.
    //   An entity can have multiple types; entity types should be single words
    // - facets: specific, inherent, defining, or non-immediate facet of an entity such as "blue", "old", "famous", "sister", "aunt_of", "weight: 4 kg"
    // Topics Terms:
    // - use empty term array for summaries
    terms: string[];
    // Use only if request explicitly asks for time range
    timeRange?: DateTimeRange | undefined; // in this time range
};

export type VerbTermV2 = {
    verbs: string[]; // action verbs,
    // - subject, object and indirectObject associated with the verb
    subject?: string | undefined;
    object?: string | undefined;
    indirectObject?: string | undefined;
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
