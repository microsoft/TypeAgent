// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DateTimeRange } from "./dateTimeSchema.js";

/* 
 A conversation is a sequence of messages between one or more users/speakers and assistants.
 The message sequence, and any entities/topics in each message are indexed.
   Entity is defined as: Specific, tangible people, places, institutions or things
 Entities and topics can be used to select their source messages
*/

// Use to search based on the topics, concepts, abstractions, feelings.
export type TopicFilter = {
    filterType: "Topic";
    // Match topics same or similar to this, such as "emotions", "politics", "health", etc.
    topics?: string;
    // Use only if request explicitly asks for time range
    timeRange?: DateTimeRange | undefined; // in this time range
};

// Use to search for specific or generic or tangible entities only mentioned in the user request
export type EntityFilter = {
    filterType: "Entity";
    // The name of the entity when user request specifies a particular item or subject (e.g., "sandwich", "Bach", "frog").
    name?: string;
    // the types of the entity such as "artist", "animal, "instrument", "school", "room", "museum", "food" etc.
    // an entity can have multiple types; entity types should be single words
    type?: string[];
    // Use only if request explicitly asks for time range
    timeRange?: DateTimeRange | undefined; // in this time range
};

export type VerbFilter = {
    // Each verb is typically a word
    verbs: string[];
    verbTense: "past" | "present" | "future";
};

// Use to search for actions performed by an entity
// Use when the user's request implies an action, like "influence"
export type ActionFilter = {
    filterType: "Action";
    // When user is looking for particular action verbs
    verbFilter?: VerbFilter;
    subjectEntityName: string | "none";
    objectEntityName?: string;
    indirectObjectEntityName?: string;
};

export type Filter = TopicFilter | EntityFilter | ActionFilter;

// Select this type of data to show the user
export type ResponseType =
    | "Entities" // Show information about matching entities
    | "Entity_Facets" // Show specific facets/facts/attributes of matching entities. E.g. name, age, interests, profession, quantity, color
    | "Topics" // Show topics or themes of discussion
    | "Answer"; // Show an answer that is derived/inferred from any matched messages, topics, entities or actions

export type ResponseStyle = "Paragraph" | "List";

// Used to get answers about:
// - topics of discussion, overviews, "what did we talk about" etc.
// - specific entities, time/date ranges, "when", "how long" etc.
// - general inquiries where the answer may not be structured or requires interpreting selected data.
// When a question references topics that may be entities, include both topic & entity filters
export type GetAnswerAction = {
    actionName: "getAnswer";
    parameters: {
        // How to filter index
        filters: Filter[];
        responseType: ResponseType;
        responseStyle: ResponseStyle;
    };
};

export type UnknownAction = {
    actionName: "unknown";
};

export type SearchAction = GetAnswerAction | UnknownAction;
