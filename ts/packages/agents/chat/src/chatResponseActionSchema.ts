// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Specific, tangible people, places, institutions or things only
export type Entity = {
    // the name of the entity or thing such as "Bach", "Great Gatsby", "frog" or "piano"
    name: string;
    // the types of the entity such as "speaker", "person", "artist", "animal", "object", "instrument", "school", "room", "museum", "food", etc.
    // An entity can have multiple types; entity types should be single words
    type: string[];
};

export type ChatResponseAction =
    | LookupAndGenerateResponseAction
    | GenerateResponseAction;

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

// this action is used to lookup information images the user has previously shared from past conversations or the internet and generate a response based on the lookup results, for example "what did we say about the project last week?" or "what is the current price of Microsoft stock?"
export interface LookupAndGenerateResponseAction {
    actionName: "lookupAndGenerateResponse";
    parameters: {
        // the original request from the user
        originalRequest: string;
        // if the request is for private information from past conversations including private events, plans, projects in progress, attachments, files, file names, and other items from discussions with team members or the assistant, use the conversation lookup filters
        conversationLookupFilters?: TermFilter[];
        // if the request is for contemporary internet information including sports scores, news events, or current commerce offerings, use the lookups parameter to request a lookup of the information on the user's behalf; the assistant will generate a response based on the lookup results
        // Lookup *facts* you don't know or if your facts are out of date.
        // E.g. stock prices, time sensitive data, etc
        // the search strings to look up on the user's behalf should be specific enough to return the correct information
        // it is recommended to include the same entities as in the user request
        internetLookups?: string[];
        // Any file references to images referred to by the message
        relatedFiles?: string[];
        // Are the contents of the files needed at this time? (i.e. does the user want to see an image or picture)
        retrieveRelatedFilesFromStorage?: boolean;
    };
}

// this is the way to handle requests for known information that is not stored in application memory or conversation memory, such as facts, definitions, explanations, captioning, or other information that can be generated without a lookup
// if the user request is a known phrase that is unrelated to the context, use this action to generate an explanation for the known phrase.
// this action is never used when the request is for private information from past conversations including private events, plans, projects in progress, and other items from discussions with team members or the assistant, unless the information is present in the chat history
export interface GenerateResponseAction {
    actionName: "generateResponse";
    parameters: {
        // the original request from the user
        originalRequest: string;
        // the generated text to show the user; this should be a complete response to the user's request
        generatedText: string;
        // ALL the actions and entities present in the text of the user's request including attachments
        userRequestEntities: Entity[];
        // ALL the actions and entities present in the generated text
        generatedTextEntities: Entity[];
        // The file names of any attachments
        relatedFiles?: string[];
    };
}
