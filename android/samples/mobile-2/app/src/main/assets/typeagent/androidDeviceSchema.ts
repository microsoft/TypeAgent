// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AndroidDeviceAction =
    | SetAlarmAction
    | SetTimerAction
    | SearchNearbyAction
    | ShowAlarmsAction
    | ShowTimersAction
    | ShowLocationAction
    | DialPhoneNumberAction
    | ComposeSmsAction
    | WebSearchAction
    | OpenWebPageAction;

// A day of the week an alarm can repeat on.
export type AlarmRepeatDay =
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
    | "saturday"
    | "sunday";

// Sets an alarm on the Android device.
// Use when the user asks to create or schedule an alarm for a time of day.
export type SetAlarmAction = {
    actionName: "setAlarm";
    parameters: {
        // The original user request, used as the alarm label.
        originalRequest: string;
        // Local time of day in HH:mm format. The device schedules the next occurrence.
        time: string;
        // Days the alarm repeats on. Omit for a one-off alarm that rings at the
        // next occurrence of the given time.
        days?: AlarmRepeatDay[];
    };
};

// Starts a countdown timer on the Android device.
// Use when the user asks for a timer or countdown lasting a specified duration.
export type SetTimerAction = {
    actionName: "setTimer";
    parameters: {
        // The original user request, used as the timer label.
        originalRequest: string;
        // Positive timer duration in seconds.
        durationInSeconds: number;
    };
};

// Opens the Android device's maps app on a search for places near the user.
// Use when the user asks to find, locate or show places nearby.
export type SearchNearbyAction = {
    actionName: "searchNearby";
    parameters: {
        // The original user request.
        originalRequest: string;
        // The kind of place to look for, for example "coffee shops".
        searchTerm: string;
    };
};

// Opens the clock app on its list of alarms.
// Use when the user asks to see, check or review their alarms.
export type ShowAlarmsAction = {
    actionName: "showAlarms";
};

// Opens the clock app on its list of countdown timers.
// Use when the user asks to see, check or review their timers.
export type ShowTimersAction = {
    actionName: "showTimers";
};

// Opens the Android device's maps app centred on one specific place.
// Use when the user names a particular address or landmark to show or get
// directions to, rather than asking to search for a category of place nearby.
export type ShowLocationAction = {
    actionName: "showLocation";
    parameters: {
        // The original user request.
        originalRequest: string;
        // A postal address or place name, for example "1 Microsoft Way, Redmond WA".
        location: string;
    };
};

// Opens the Android device's phone dialer pre-filled with a number.
// The user still has to press the call button, so this never places a call by
// itself. Use when the user asks to call or phone someone.
export type DialPhoneNumberAction = {
    actionName: "dialPhoneNumber";
    parameters: {
        // The original user request.
        originalRequest: string;
        // The number to dial. Digits, spaces and the characters + - ( ) . # * only.
        phoneNumber: string;
    };
};

// Opens the Android device's messaging app on a pre-filled draft text message.
// The user still has to press send, so this never sends a message by itself.
// Use when the user asks to text or message someone.
export type ComposeSmsAction = {
    actionName: "composeSms";
    parameters: {
        // The original user request.
        originalRequest: string;
        // The message body to pre-fill.
        message: string;
        // The recipient's number. Omit when the user did not name a recipient;
        // the messaging app then opens with an empty recipient field.
        phoneNumber?: string;
    };
};

// Runs a search in the Android device's own browser or search app.
// Use only when the user explicitly asks to search on their phone or to see
// results in their browser - otherwise answer the question directly instead.
export type WebSearchAction = {
    actionName: "webSearch";
    parameters: {
        // The original user request.
        originalRequest: string;
        // The search query.
        query: string;
    };
};

// Opens a web page in the Android device's browser.
// Use when the user asks to open or visit a specific web address.
export type OpenWebPageAction = {
    actionName: "openWebPage";
    parameters: {
        // The original user request.
        originalRequest: string;
        // An absolute http:// or https:// URL. Other schemes are rejected.
        url: string;
    };
};
