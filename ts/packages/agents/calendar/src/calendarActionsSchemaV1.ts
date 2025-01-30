// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CalendarAction =
    | AddEventAction
    | RemoveEventAction
    | AddParticipantsAction
    | ChangeTimeAction
    | ChangeDescriptionAction
    | FindEventsAction;

// Add an event to the calendar
export type AddEventAction = {
    actionName: "addEvent";
    parameters: {
        event: Event;
    };
};

// Remove the event from the calendar
export type RemoveEventAction = {
    actionName: "removeEvent";
    parameters: {
        // calendar event to remove
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

// Change the time of an event on the calendar
export type ChangeTimeAction = {
    actionName: "changeTime";
    parameters: {
        // calendar event to be changed
        eventReference?: EventReference;
        // new time range for the event
        timeRange: EventTimeRange;
    };
};

// Change the description of an event on the calendar
export type ChangeDescriptionAction = {
    actionName: "changeDescription";
    parameters: {
        // calendar event to be changed
        eventReference?: EventReference;
        // new description for the event
        description: string;
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

// EventTimeRange is filled only if the user specifies the start time and/or the end time in the event
// For requests like: Create a meeting for next Friday note than the time range is not specified
// and the timeRange property should be empty. Please don't use the context or history to fill this value.
export type EventTimeRange = {
    // use the format hh:mm pm (example: 2:30 pm), for noon emit 12:00 pm, for midnight emit 12:00 am
    // validate if the time is mentioned in the user input, leave empty if not specified
    startTime?: string;
    // use the format hh:mm pm (example: 2:30 pm), for noon emit 12:00 pm, for midnight emit 12:00 am
    endTime?: string;
    // duration of the event; only given when the requester specifies the duration
    duration?: string;
};

// Fill the properties of the Event object with the information provided by the user
// All fields in an Event object should be filled based on the user input, don't use the context or history to fill these properties.
export type Event = {
    // date (example: May 5th or March 22, 2024) or relative date (example: after EventReference)
    // if the user has not specified a year please just use the month and day
    day: string;
    // leave the value empty if not specified by the user. Don't use the context to fill this value.
    timeRange: EventTimeRange;
    // Use the current date to compute this field, so phrases like "today" can be converted to an absolute
    // date like 5/20/2024 if the current date is 5/20/2024. Same for "tomorrow" and "yesterday".
    // Also for requests have a relative date like "next week" or "in 3 days" or "first Monday in July" the translated date should be
    // computed based on the current date.
    translatedDate?: string;
    description: string;
    location?: string;
    // a list of people or named groups like 'team'. Leave empty if not specified by the user.
    participants?: string[];
};

// properties used by the requester in referring to an event
// these properties are only specified if given directly by the requester
export type EventReference = {
    // date (example: March 22, 2024) or relative date (example: after EventReference)
    // if the user has not specified a year please just use the month and day
    day?: string;
    // (examples: this month, this week, in the next two days)
    dayRange?: string;
    // the event time range if the requester specifies the time range
    // as in 1pm to 2pm or starts at 1:00pm and runs for 2 hours
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
