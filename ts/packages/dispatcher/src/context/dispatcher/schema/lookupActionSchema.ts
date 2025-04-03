// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type LookupAction = LookupAndAnswerAction;
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

// look up for contemporary internet information including sports scores, news events, or current commerce offerings, use the lookups parameter to request a lookup of the information on the user's behalf; the assistant will generate a response based on the lookup results
// Lookup *facts* you don't know or if your facts are out of date.
// E.g. stock prices, time sensitive data, etc
// the search strings to look up on the user's behalf should be specific enough to return the correct information
// it is recommended to include the same entities as in the user request
type LookupInternet = {
    source: "internet";
    internetLookups: string[];
    // specific sites to look up in.
    site?: string[];
};

// The user request is a question about previous conversations or general knowledge that can be found from the internet.
// (e.g. "what did we say about the project last week?" or "what is the current price of Microsoft stock?")
// The user expects only the answer, and not an action to be taken.
export interface LookupAndAnswerAction {
    actionName: "lookupAndAnswer";
    parameters: {
        // the original request from the user
        originalRequest: string;
        // The question to get answer for.
        question: string;
        lookup: LookupConversation | LookupInternet;
    };
}
