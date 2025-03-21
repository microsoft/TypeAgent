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

export type ChatResponseAction = GenerateResponseAction | ShowImageFileAction;

export interface ShowImageFileAction {
    actionName: "showImageFile";
    parameters: {
        // file entities.
        files: string[];
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
