// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Built-in entity types for temporal expressions
// These will have validation functions that parse natural language dates/times
export type CalendarDate = string; // "tomorrow", "next Monday", "July 15", "2024-03-15"
export type CalendarTime = string; // "2pm", "14:00", "noon", "3:30pm"
export type EventDescription = string; // "meeting", "dentist appointment", "lunch"
export type LocationName = string; // "conference room", "Starbucks", "home"
export type ParticipantName = string; // "John", "Sarah", "team"

// Entity types for the calendar agent
export type CalendarEntities =
    | CalendarDate
    | CalendarTime
    | EventDescription
    | LocationName
    | ParticipantName;

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
        // What the event is about (required)
        description: EventDescription;
        // When the event occurs (required)
        date: CalendarDate;
        // What time the event starts (optional, defaults to all-day if not specified)
        time?: CalendarTime;
        // Where the event takes place (optional)
        location?: LocationName;
        // Who else should attend (optional, single participant)
        participant?: ParticipantName;
    };
};

// Find events on the calendar
// Examples: "find my meetings today", "show meetings with Bob"
export type FindEventsAction = {
    actionName: "findEvents";
    parameters: {
        // When to search (optional, defaults to future events)
        date?: CalendarDate;
        // What type of event to find (optional, finds all if not specified)
        description?: EventDescription;
        // Find events with a specific participant (optional)
        participant?: ParticipantName;
    };
};

// Add a participant to an event
// Examples: "add John to the meeting", "invite Sarah to lunch"
export type AddParticipantAction = {
    actionName: "addParticipant";
    parameters: {
        // Which event to add to (required)
        description: EventDescription;
        // Who to add (required)
        participant: ParticipantName;
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
