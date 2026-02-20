// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Built-in entity types for temporal expressions
// These entity types can be deterministically recognized by converters
// IMPORTANT: Preserve the user's original expression EXACTLY as they typed it.
// Do NOT convert to ISO dates or other formats - the handler will parse temporal expressions.
export type CalendarDate = string; // "today", "tomorrow", "next Monday", "Friday", "July 15" - use user's exact words
export type CalendarTime = string; // "2pm", "14:00", "noon", "3:30pm" - use user's exact words
export type CalendarTimeRange = string; // "2pm to 3pm", "9am-10am", "1-2pm" - use user's exact words

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
    | FindThisWeeksEventsAction
    | RemoveEventAction;

// Schedule a new event on the calendar
// Examples: "schedule a meeting tomorrow at 2pm", "add dentist appointment on Friday at 3pm"
export type ScheduleEventAction = {
    actionName: "scheduleEvent";
    parameters: {
        // What the event is about (required) - plain string, not an entity type
        description: string;
        // When the event occurs (required) - use the user's EXACT words like "today", "tomorrow", "Friday", "next week"
        // Do NOT convert to ISO date format - the handler will parse temporal expressions
        date: CalendarDate;
        // What time the event starts (optional, defaults to all-day if not specified)
        // Use the user's EXACT words like "2pm", "3:30", "noon" - do NOT convert formats
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
        // Use the user's EXACT words like "today", "tomorrow", "this week" - do NOT convert to ISO date
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

// Remove an event from the calendar
// Examples: "delete my meeting", "remove the dentist appointment", "cancel lunch with Bob"
// Behavior based on number of matches:
// - 1 match: prompts for confirmation
// - 2-5 matches: prompts with list to select which event to delete
// - More than 5 matches: returns error asking user to be more specific
export type RemoveEventAction = {
    actionName: "removeEvent";
    parameters: {
        // What event to remove (required) - plain string describing the event
        description: string;
        // Optional date filter to narrow down which event to remove
        // Use the user's EXACT words like "today", "tomorrow", "this week" - do NOT convert to ISO date
        date?: CalendarDate;
    };
};
