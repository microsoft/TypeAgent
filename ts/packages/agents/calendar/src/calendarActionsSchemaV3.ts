// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Built-in entity types for temporal expressions
// These entity types can be deterministically recognized by converters
export type CalendarDate = string; // "tomorrow", "next Monday", "July 15", "2024-03-15"
export type CalendarTime = string; // "2pm", "14:00", "noon", "3:30pm"
export type CalendarTimeRange = string; // "2pm to 3pm", "9am-10am", "1-2pm", "from 2pm until 4pm"

// Entity types for the calendar agent
// Note: Only includes deterministically recognizable entities (dates, times, and time ranges)
// EventDescription, LocationName, and ParticipantName cannot be deterministically
// recognized and must use plain string wildcards for now
export type CalendarEntities = CalendarDate | CalendarTime | CalendarTimeRange;

export type CalendarActionV3 =
    | ScheduleEventAction
    | FindEventsAction
    | AddParticipantAction
    | FindTodaysEventsAction
    | FindThisWeeksEventsAction;

// Schedule a new event on the calendar
// Examples: "schedule a meeting tomorrow at 2pm", "add dentist appointment on Friday at 3pm"
export type ScheduleEventAction = {
    actionName: "scheduleEvent";
    parameters: {
        // What the event is about (required) - plain string, not an entity type
        description: string;
        // When the event occurs (required) - deterministically recognizable
        date: CalendarDate;
        // What time the event starts (optional, defaults to all-day if not specified)
        // Can be a single time (2pm, 14:00) or a time range (2pm to 3pm, 9am-10am)
        time?: string;
        // Where the event takes place (optional) - plain string, not an entity type
        location?: string;
        // Who else should attend (optional, single participant) - plain string, not an entity type
        participant?: string;
    };
};

// Find events on the calendar
// Examples: "find my meetings today", "show meetings with Bob"
export type FindEventsAction = {
    actionName: "findEvents";
    parameters: {
        // When to search (optional, defaults to future events)
        date?: CalendarDate;
        // What type of event to find (optional, finds all if not specified) - plain string
        description?: string;
        // Find events with a specific participant (optional) - plain string
        participant?: string;
    };
};

// Add a participant to an event
// Examples: "add John to the meeting", "invite Sarah to lunch"
export type AddParticipantAction = {
    actionName: "addParticipant";
    parameters: {
        // Which event to add to (required) - plain string
        description: string;
        // Who to add (required) - plain string
        participant: string;
    };
};

// Find all events happening today
// Examples: "what do I have today", "show me today's schedule"
export type FindTodaysEventsAction = {
    actionName: "findTodaysEvents";
    parameters: {};
};

// Find all events happening this week
// Examples: "what do I have this week", "show my week"
export type FindThisWeeksEventsAction = {
    actionName: "findThisWeeksEvents";
    parameters: {};
};
