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
    | OpenWebPageAction
    | ComposeEmailAction
    | ShareTextAction
    | OpenSettingsAction
    | CreateCalendarEventAction
    | PlayMusicFromSearchAction;

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

// Opens the Android device's email app on a pre-filled draft message.
// The user still has to press send, so this never sends mail by itself.
// Use when the user asks to email someone.
export type ComposeEmailAction = {
    actionName: "composeEmail";
    parameters: {
        // The original user request.
        originalRequest: string;
        // Recipient email addresses. Omit when the user did not name anyone;
        // the email app then opens with an empty To field.
        to?: string[];
        // Carbon-copy recipients.
        cc?: string[];
        // Blind carbon-copy recipients.
        bcc?: string[];
        // The subject line.
        subject?: string;
        // The message body.
        body?: string;
    };
};

// Offers a piece of text to the Android share sheet so the user can pass it to
// another app. Use only when the user explicitly asks to share, send or post
// some text they have named; the user picks the destination app and confirms.
export type ShareTextAction = {
    actionName: "shareText";
    parameters: {
        // The original user request.
        originalRequest: string;
        // The exact text to share.
        text: string;
        // An optional title or subject offered to apps that can use one.
        subject?: string;
    };
};

// A settings screen this device agent is allowed to open.
export type AndroidSettingsScreen =
    | "settings"
    | "wifi"
    | "bluetooth"
    | "display"
    | "sound"
    | "location"
    | "battery"
    | "airplaneMode"
    | "dateAndTime"
    | "storage"
    | "accessibility"
    | "security"
    | "appInfo";

// Opens one of the Android device's settings screens.
// Use when the user asks to change a device setting - the app cannot toggle
// settings directly, so it takes the user to the right screen instead.
export type OpenSettingsAction = {
    actionName: "openSettings";
    parameters: {
        // The original user request.
        originalRequest: string;
        // Which settings screen to open. Only these screens are supported;
        // "settings" is the top-level settings app and "appInfo" is this chat
        // app's own details page.
        screen: AndroidSettingsScreen;
    };
};

// Opens the Android device's calendar app on a pre-filled new event.
// The user still has to save it, so this never writes to a calendar by itself.
// Use when the user asks to create, schedule or add a calendar event.
export type CreateCalendarEventAction = {
    actionName: "createCalendarEvent";
    parameters: {
        // The original user request.
        originalRequest: string;
        // The event title.
        title: string;
        // Local start time as ISO-8601 without a time zone, for example
        // "2026-08-24T15:00". For an all-day event use a date only,
        // "2026-08-24". Times are interpreted in the device's own time zone,
        // so never convert to UTC and never append "Z" or an offset.
        start: string;
        // Local end time in the same format as start. Omit for a one hour
        // event, or a single day when allDay is true.
        end?: string;
        // True when the event covers whole days rather than a time of day.
        allDay?: boolean;
        // Where the event takes place.
        location?: string;
        // Longer notes about the event.
        description?: string;
    };
};

// What a music search query names.
export type MusicSearchFocus =
    | "any"
    | "artist"
    | "album"
    | "song"
    | "playlist";

// Asks the Android device's music app to play something matching a search.
// Use when the user asks to play music, an artist, an album or a song.
export type PlayMusicFromSearchAction = {
    actionName: "playMusicFromSearch";
    parameters: {
        // The original user request.
        originalRequest: string;
        // What to search for, for example "Kind of Blue" or "Miles Davis".
        query: string;
        // What the query names. Omit or use "any" when it is unclear, which
        // lets the music app decide.
        focus?: MusicSearchFocus;
    };
};
