// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type NotificationAction =
    | ShowNotificationsAction
    | ShowNotificationSummaryAction
    | ClearNotificationsAction
    | TestNotificationAction
    | TestStatusNoticeAction;

// Shows notifications based on the supplied filter
export type ShowNotificationsAction = {
    actionName: "showNotifications";
    parameters: {
        filter: NotificationFilter;
    };
};

export type NotificationFilter = "all" | "unread";

// Shows notification summary
export type ShowNotificationSummaryAction = {
    actionName: "showNotificationSummary";
};

// Clears the notifications
export type ClearNotificationsAction = {
    actionName: "clearNotifications";
};

// Fire a synthetic notification to verify TypeAgent notification rendering.
export type TestNotificationAction = {
    actionName: "testNotification";
    parameters: {
        // Notification body text.
        message: string;
        // Rendering mode; defaults to toast.
        mode?: "toast" | "inline" | "info" | "warning" | "error";
    };
};

// Fire a persistent status notice to verify the TypeAgent notification bell.
export type TestStatusNoticeAction = {
    actionName: "testStatusNotice";
    parameters?: {
        // Optional notice text; defaults to the built-in test message.
        message?: string;
        // Severity accent; defaults to warning.
        level?: "info" | "warning" | "error";
        // Whether to include a Restart server action button.
        restart?: boolean;
    };
};
