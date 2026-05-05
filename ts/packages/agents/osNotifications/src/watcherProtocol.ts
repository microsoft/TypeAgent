// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Wire types shared between the per-platform watchers and the agent. All
// watchers normalize their native event source into this shape. The Windows
// watcher reads JSON-per-line from a helper exe; the Linux watcher emits the
// same shape directly from in-process D-Bus monitoring.

export type OsNotificationAdded = {
    kind: "added";
    // Platform-supplied id. Used as the dismiss key (the shell renderer keys
    // chat bubbles by `notification-os-${id}`).
    id: string;
    // App name / sender. Used for allowList / blockList matching.
    app: string;
    title: string;
    body: string;
    // Epoch ms.
    timestamp: number;
};

export type OsNotificationRemoved = {
    kind: "removed";
    // Matches the id of a previously-emitted "added" event. Watchers MUST
    // emit "removed" for every "added" they emit when the platform reports
    // the corresponding notification has been dismissed.
    id: string;
};

export type OsNotificationError = {
    kind: "error";
    // Free-form. Surfaced once via context.notify(Warning, ...) by the agent.
    message: string;
};

export type OsNotificationEvent =
    | OsNotificationAdded
    | OsNotificationRemoved
    | OsNotificationError;

// The agent stops the watcher (removes listeners, terminates child process)
// when the agent is disabled or context is torn down.
export interface OsNotificationWatcher {
    stop(): Promise<void>;
}

export type OsNotificationListener = (event: OsNotificationEvent) => void;
