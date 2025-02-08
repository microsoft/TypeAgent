// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

type NamedTime = "Noon" | "Midnight";
type SpecialDay =
    | "StartOfWeek"
    | "EndOfWeek"
    | "StartOfMonth"
    | "EndOfMonth"
    | "StartOfYear"
    | "EndOfYear";
type SpecialDateTime = "Now" | "InThePast" | "InTheFuture";

// a specific date and time used in a query time range
export type CalendarDateTime = {
    // used instead of the rest of the parameters to specify now, in the past, or in the future
    specialDateTime?: SpecialDateTime;
    // leave undefined for the current year
    // examples: "-1y" for previous year, "+1y" for next year, "-2y" for two years ago
    year?: string;
    // examples: "July", "-1M" for last month, "-3M" for last quarter, "+4M" for four months from now; default is this month
    month?: string;
    // examples: "-1w" for last week; default is this week
    week?: string;
    // examples: "10", "-1d", "+3d", "4", "Monday", "StartOfWeek", "EndOfMonth", "EndOfYear"; default is today
    day?: string | SpecialDay;
    // hour, minutes and seconds using 24 hour format; default is now
    // examples: "-1:00:00" for previous hour, "14:30:00", "Noon", "23:59:59" for end of day, "23:45:00" for quarter to midnight, "+2:40:00" for two hours and forty minutes from now
    hms?: string | NamedTime;
};

// EventTimeRange is filled only if the user specifies the start time and/or the end time for the event
// Please don't use the context or history to fill this value.
export type EventTimeRange = {
    // start and end are always used unless the query is for the entire calendar date time range
    // the start of the time range for the query. examples: "today", "tomorrow", "yesterday", "next Monday", "last week", "in 3 days", "first Monday in July"
    startDateTime?: CalendarDateTime;
    // the end of the time range for the query, inclusive; if start is present end will also be present
    endDateTime?: CalendarDateTime;
    // duration of the event; only given when the requester specifies the duration
    duration?: string;
};

// Fill the properties of the Event object with the information provided by the user
// All fields in an Event object should be filled based on the user input, don't use the context or history to fill these properties.
export type Event = {
    // leave the value empty if not specified by the user. Don't use the context to fill this value.
    timeRange: EventTimeRange;
    description: string;
    // leave the value empty if not specified by the user. Don't use the context to fill this value.
    location?: string;
    // a list of people or named groups like 'team'. Leave empty if not specified by the user.
    participants?: string[];
};

// properties used by the requester in referring to an event
// these properties are only specified if given directly by the requester
export type EventReference = {
    // the event time range if the requester specifies the time range
    timeRange?: EventTimeRange;
    // the default value should be empty if not specified by the user
    description?: string;
    location?: string;
    // only specified if the requester specifies the participants
    participants?: string[];
    // the value should be true or false based on user input
    // if the user refers to the event as 'the meeting' or 'the event' or it set to true
    // For Ex: the user says add Jen to the meeting, the lookup property should have the value of true
    lookup?: boolean;
    // Only use an EXISTING id to refer/update an existing event. The value will be
    // found as part of the context or the history of the conversation.
    // The value should be empty for new events.
    eventid?: string;
};

export type CalendarAction =
    | AddEventAction
    | FindEventsAction
    | AddParticipantsAction;

// Add an event to the calendar
export type AddEventAction = {
    actionName: "addEvent";
    parameters: {
        event: Event;
    };
};

// Find an event on the calendar
export type FindEventsAction = {
    actionName: "findEvents";
    parameters: {
        // one or more event properties to use to search for matching events
        eventReference: EventReference;
    };
};

// Add participants to an event on the calendar
export type AddParticipantsAction = {
    actionName: "addParticipants";
    parameters: {
        // calendar event to be augmented; if not specified assume last event discussed
        eventReference?: EventReference;
        // new participants (one or more)
        participants: string[];
    };
};
