// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type OsNotificationsActions =
    | SyncOsNotificationsAction
    | TestOsNotificationAction;

// Re-emit currently-present OS notifications through the agent pipeline.
// Triggers the build prompt (yes/no card) when the helper exe is missing.
// Windows only; surfaces a warning on Linux/macOS.
export interface SyncOsNotificationsAction {
    actionName: "syncOsNotifications";
    parameters: {};
}

// Inject a synthetic notification through the agent pipeline (filters, rate
// limit, dismiss tracking) — useful for verifying the agent end-to-end
// without an OS notification source.
export interface TestOsNotificationAction {
    actionName: "testOsNotification";
    parameters: {
        // Notification body text.
        message: string;
        // Optional app name to attach (matched against allowList/blockList).
        app?: string;
        // Optional notification title.
        title?: string;
    };
}
