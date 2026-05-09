// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type TimerAction =
    | SetReminderAction
    | RepeatReminderAction
    | ListRemindersAction
    | CancelReminderAction;

// Set a reminder. When it fires, the timer agent pushes a message to the
// user via SessionContext.beginAgentThread (an agent-initiated thread, not a
// response to a user request).
export type SetReminderAction = {
    actionName: "setReminder";
    parameters: {
        // What to remind the user about.
        message: string;
        // When to fire. Either a duration like "5s", "10m", "1h", "30 minutes",
        // or an absolute ISO 8601 timestamp like "2026-05-04T15:30:00".
        when: string;
        // How the fired reminder should render. Defaults to "bubble".
        kind?: "bubble" | "toast" | "inline";
    };
};

// Set a repeating reminder. Fires every `every` interval until cancelled
// (or until `count` fires have elapsed if specified). Useful for stress
// testing rapid-fire / back-to-back agent-initiated messages.
export type RepeatReminderAction = {
    actionName: "repeatReminder";
    parameters: {
        // What to remind the user about.
        message: string;
        // Interval between fires. Same format as SetReminder.when —
        // a duration like "5s", "10m", "1h".
        every: string;
        // Render style for each fire. Defaults to "bubble".
        kind?: "bubble" | "toast" | "inline";
        // Optional max number of times to fire. If omitted, fires until
        // explicitly cancelled.
        count?: number;
    };
};

// List all pending reminders.
export type ListRemindersAction = {
    actionName: "listReminders";
    parameters: {};
};

// Cancel a pending reminder by id, or all reminders.
export type CancelReminderAction = {
    actionName: "cancelReminder";
    parameters: {
        // The reminder id (returned from setReminder), or "all" to cancel
        // every pending reminder.
        id: string;
    };
};
