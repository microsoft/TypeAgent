// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The following types define the structure of an object of type CalendarAction that represents the requested calendar action

export type CalendarAction =
    | AddEventAction
    | RemoveEventAction
    | AddParticipantsAction;

export type AddEventAction = {
    actionName: "addEvent";
    parameters: {
        event?: Event;
        // For user requests where action is interpreted but the event is not defined, provide a
        // response to the user that mentions that they need to provide more information
        fuzzyResponse?: string;
    };
};

export type RemoveEventAction = {
    actionName: "removeEvent";
    parameters: {
        eventReference: EventReference;
    };
};

export type AddParticipantsAction = {
    actionName: "addParticipants";
    parameters: {
        // event to be augmented; if not specified assume last event discussed
        eventReference?: EventReference;
        // new participants (one or more)
        participants: string[];
    };
};

export type EventTimeRange = {
    // use the format hh:mm pm (example: 2:30 pm), for noon emit 12:00 pm, for midnight emit 12:00 am
    startTime?: string;
    // use the format hh:mm pm (example: 2:30 pm), for noon emit 12:00 pm, for midnight emit 12:00 am
    endTime?: string;
    // duration of the event; only given when the requester specifies the duration
    duration?: string;
};

export type Event = {
    // date (example: May 5th or March 22, 2024) or relative date (example: after EventReference)
    // if the user has not specified a year please just use the month and day
    day: string;
    timeRange: EventTimeRange;
    description: string;
    location?: string;
    // a list of people or named groups like 'team'
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
    description?: string;
    location?: string;
    participants?: string[];
};
