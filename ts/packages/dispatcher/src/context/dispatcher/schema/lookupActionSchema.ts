// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type LookupAction = LookupAndAnswerAction;
export type LookupActivity = StartLookupAction;
export type DateVal = {
    day: number;
    month: number;
    year: number;
};

export type TimeVal = {
    // In 24 hour form
    hour: number;
    minute: number;
    seconds: number;
};

export type DateTime = {
    date: DateVal;
    time?: TimeVal | undefined;
};

export type DateTimeRange = {
    startDate: DateTime;
    stopDate?: DateTime | undefined;
};

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
    terms: string[];
    // Use only if request explicitly asks for time range
    timeRange?: DateTimeRange | undefined; // in this time range
};

// look up for private information from past conversations (i.e. chat history) including private events, plans, projects in progress, attachments, files, file names, and other items from discussions with team members or the assistant, use the conversation lookup filters
type LookupConversation = {
    source: "conversation";
    conversationLookupFilters: TermFilter[];
};

// The user request is a question about previous conversations.
// (e.g. "what did we say about the project last week?")
// The user expects only the answer, and not an action to be taken.
export interface LookupAndAnswerAction {
    actionName: "lookupAndAnswer";
    parameters: {
        // the original request from the user
        originalRequest: string;
        // The question to get answer for.
        question: string;
        lookup: LookupConversation;
    };
}

export type StartLookupConversation = {
    source: "conversation";
};

export type StartLookupInternet = {
    source: "internet";
    site?: string[]; // specific sites to look up in.
};

// The user want to start looking information for a specific source without specifying what to look for.
// Don't use this action if the request includes what to look for.
export interface StartLookupAction {
    actionName: "startLookup";
    parameters: {
        lookup: StartLookupConversation | StartLookupInternet;
    };
}
