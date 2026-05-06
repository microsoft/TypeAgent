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
    // True if this event was emitted in response to syncNow(), i.e. it
    // reflects current action-center state rather than a live "newly
    // arrived" notification. The agent uses this to bypass the
    // "drop pre-enable notifications" timestamp gate. Optional / absent
    // for live events.
    fromSync?: boolean;
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

    // Triggers a one-shot enumeration of currently-present notifications.
    // Each notification is delivered to the listener as an "added" event with
    // fromSync: true. Implementations that don't support enumeration (Linux
    // dbus eavesdrop, macOS, no-op) should throw with a clear, user-facing
    // message — the agent's command handler surfaces it via actionIO.
    syncNow(): Promise<void>;
}

export type OsNotificationListener = (event: OsNotificationEvent) => void;
