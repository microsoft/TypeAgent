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
    // examples: "-1:00:00" for previous hour, "14:30:00", "Noon", "EndOfDay", "23:45:00" for quarter to midnight, "+2:40:00" for two hours and forty minutes from now
    hms?: string | NamedTime;
};

export type CalendarSearchAction = {
    actionName: "calendar search";
    parameters: {
        // used when the user query specifies a person; if the user asks about themselves, use "me"
        attendees?: string[];
        // start and end are always used unless the query is for the entire calendar date time range
        // the start of the time range for the query
        start?: CalendarDateTime;
        // the end of the time range for the query, inclusive; if start is present end will also be present
        end?: CalendarDateTime;
        // used when the user query should only return a single event
        singleEvent?: boolean;
        // used ONLY if there are key phrases that might match the meeting description, such as "soccer game", "blue team", "dev sync", but NOT FOR generic terms about schedules like "meeting", "discussion", "session", "organize", "arrange"; for example "tell me about the cookie discussion" has keyphrase "cookie" and "which finance meeting should I skip" has keyphrase "finance"
        meetingDescriptionKeyphrases?: string[];
    };
};
