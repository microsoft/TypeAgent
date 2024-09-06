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
    | GreetingResponseAction
    | GenerateResponseAction
    | LookupAndGenerateResponseAction;

// do not use this action if the request can be handled by any other action
// this is the way to handle requests for general chat information like "what is the weather" or "tell me a joke"
// prefer GenerateResponseAction over switching to a different assistant if the request is for general chat information
export interface GenerateResponseAction {
    actionName: "generateResponse";
    parameters: {
        // the original request from the user
        originalRequest: string;
        // the generated text to show the user; this should be a complete response to the user's request
        generatedText: string;
        // ALL the actions and entities present in the text of the user's request
        userRequestEntities: Entity[];
        // ALL the actions and entities present in the generated text
        generatedTextEntities: Entity[];
    };
}

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

// DO NOT use this action for a request for information stored in application memory, such as a list, playlist, album, table etc.; instead use the information retrieval actions for the specific application storage
// this action is used to lookup information from past conversations or the internet and generate a response based on the lookup results
export interface LookupAndGenerateResponseAction {
    actionName: "lookupAndGenerateResponse";
    parameters: {
        // the original request from the user
        originalRequest: string;
        // if the request is for private information from past conversations including private events, plans, projects in progress, and other items from discussions with team members or the assistant, use the conversation lookup filters
        conversationLookupFilters?: TermFilter[];
        // if the request is for contemporary internet information including sports scores, news events, or current commerce offerings, use the lookups parameter to request a lookup of the information on the user's behalf; the assistant will generate a response based on the lookup results
        // Lookup *facts* you don't know or if your facts are out of date.
        // E.g. stock prices, time sensitive data, etc
        // the search strings to look up on the user's behalf should be specific enough to return the correct information
        // it is recommended to include the same entities as in the user request
        internetLookups?: string[];
    };
}

// Use this action to response to the user greeting you. 
// Generate a dozen possible greetings and make sure they are varied in tone, length, and don't sound similar.
// Some should be single word responses
// DO NOT use it if the user gave you a question or is seeking information.
export interface GreetingResponseAction {
    actionName: "generateGreetingResponse";
    parameters: {
        // the original request/greeting from the user
        originalRequest: string;
        // a set possible greeting responses to the user
        possibleGreetings: Greeting[];
    };
}

// A typical greeting between two people including the mood of the delivery and the tet of the greeting.
export interface Greeting {
    // the mood of the chosen response such as, but not limited to: friendly, enthusiastic, excited, polite, cheerful, happy, positive, welcoming, affectionate, warm, jovial, lively, energetic, radiant, breezy
    mood: string;
    // The greeting response to the user such as "Top of the morning to ya!" or "Hey, how's it going?" or "What a nice day we're having, what's up!?" or "What are we going to do today?"
    // Be sure to make the greeting relevant to time of day (i.e. don't say good morning in the afternoon).
    // you can also use greetings such as Namaste/Shalom/Bonjour or equivalent.
    generatedGreeting: string;
}
