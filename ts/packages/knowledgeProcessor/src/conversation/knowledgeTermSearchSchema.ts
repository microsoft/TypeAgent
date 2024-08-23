// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DateTimeRange } from "./dateTimeSchema.js";

/* 
 Conversation memory is a sequence of messages between one or more users/speakers and assistants.
 The message sequence, and any entities, actions and topics in each message are indexed.
 */

export type TermFilter = {
    // Search indexes for following terms
    // Terms are nouns, verbs, adverbs that define entities, actions and topics
    // - the name of an entity or thing such as "Bach", "Great Gatsby", "frog" or "piano"
    // - the types of the entity such as "speaker", "person", "artist", "animal", "object", "instrument", "school", "room", "museum", "food" etc.
    // - specific, inherent, defining, or non-immediate facet of an entity such as "blue", "old", "famous", "sister", "aunt_of", "weight: 4 kg"
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
