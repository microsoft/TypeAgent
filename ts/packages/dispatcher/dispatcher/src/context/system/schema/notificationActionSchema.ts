// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type NotificationAction =
    | ShowNotificationsAction
    | ShowNotificationSummaryAction
    | ClearNotificationsAction;

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
