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
    | GenerateResponseAction
    | LookupAndGenerateResponseAction;

// use this GenerateResponseAction if the request should be handled by showing the user a generated message instead of running an action which will generate a message
// this is the way to handle requests for general chat information like "what is the weather" or "tell me a joke"
// prefer this action to switching to a different assistant if the request is for general chat information
export interface GenerateResponseAction {
    actionName: "generateResponse";
    parameters: {
        // the original request from the user
        originalRequest: string;
        // the generated text to show the user; if lookups are used, this text should let the user know a lookup is in progress
        generatedText: string;
        // ALL the actions and entities present in the text of the user's request
        userRequestEntities: Entity[];
        // ALL the actions and entities present in the generated text
        generatedTextEntities: Entity[];
    };
}

// if the request is for contemporary chat information including sports scores, news events, or current commerce offerings, use the lookups parameter to request a lookup of the information on the user's behalf; the assistant will generate a response based on the lookup results

export interface LookupAndGenerateResponseAction {
    actionName: "lookupAndGenerateResponse";
    parameters: {
        // the original request from the user
        originalRequest: string;
        // ALL the actions and entities present in the user's request
        userRequestEntities: Entity[];
        // Lookup *facts* you don't know or if your facts are out of date.
        // E.g. stock prices, time sensitive data, etc
        // the search strings to look up on the user's behalf should be specific enough to return the correct information
        // it is recommended to include the same entities as in the user request
        lookups: string[];
    };
}
