// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DateTimeRange } from "./dateTimeSchema.js";

/* 
 Conversation memory is a sequence of messages between one or more users/speakers and assistants.
 The message sequence, and any entities, actions and topics in each message are indexed.
 */

// Search indexes for following search terms: typically single word keywords.
export type TermFilter = {
    // action verb terms to look for
    verbs?: string[];
    // Terms are one of the following:
    // Entity Terms:
    // - the name of an entity or thing such as "Bach", "Great Gatsby", "frog" or "piano"
    // - the *type* of the entity such as "speaker", "person", "artist", "animal", "object", "instrument", "school", "room", "museum", "food" etc.
    //   An entity can have multiple types; entity types should be single words
    // - facets: specific, inherent, defining, or non-immediate facet of an entity such as "blue", "old", "famous", "sister", "aunt_of", "weight: 4 kg"
    // Action Terms:
    // - subject, object and indirectObject associated with the verb
    // verbs are not duplicated
    // Topics Terms:
    // - use empty term array for summaries
    terms: string[];
    // Use only if request explicitly asks for time range
    timeRange?: DateTimeRange | undefined; // in this time range
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
