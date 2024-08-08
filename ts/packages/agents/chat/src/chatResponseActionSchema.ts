// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface Entity {
    // the name of the entity such as "Bach" or "frog"
    name: string;
    // the types of the entity such as "artist" or "animal"; an entity can have multiple types; entity types should be single words
    type: string[];
}
// use this ChatResponseAction if the request should be handled by showing the user a generated message instead of running an action which will generate a message
// this is the way to handle requests for general chat information like "what is the weather" or "tell me a joke"
// prefer this action to switching to a different assistant if the request is for general chat information
// if the request is for contemporary chat information including sports scores, use the lookups parameter to request a lookup of the information on the user's behalf
export interface ChatResponseAction {
    actionName: "chatResponse";
    parameters: {
        // the original request from the user
        originalRequest: string;
        // the generated text to show the user; if lookups are used, this text should let the user know a lookup is in progress
        generatedText: string;
        // all entities present in the user's request
        userRequestEntities: Entity[];
        // all entities present in the generated text
        generatedTextEntities: Entity[];
        // Lookup *facts* you don't know or if your facts are out of date.
        // E.g. stock prices, time sensitive data, etc
        // the search strings to look up on the user's behalf should be specific enough to return the correct information
        // it is recommended to include the same entities as in the user request
        lookups?: string[];
    };
}
