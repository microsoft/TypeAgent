// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type NotificationAction =
    | ShowNotificationsAction
    | ShowNotificationSummaryAction
    | ClearNotificationsAction;

// Shows notifications based on the supplied filter
export type ShowNotificationsAction = {
    actionName: "show";
    parameters: {
        filter: NotificationFilter;
    };
};

export type NotificationFilter = "all" | "unread";

// Shows notification summary
export type ShowNotificationSummaryAction = {
    actionName: "summary";
};

// Clears the notifications
export type ClearNotificationsAction = {
    actionName: "clear";
};
