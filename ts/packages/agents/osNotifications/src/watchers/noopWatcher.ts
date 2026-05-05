// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    OsNotificationListener,
    OsNotificationWatcher,
} from "../watcherProtocol.js";

// Used for macOS (no supported public API to read other apps' notifications)
// and as a fallback for unknown platforms. Emits a one-time error event so
// the agent can surface the unsupported state to the user, then idles.
export function startNoopWatcher(
    listener: OsNotificationListener,
    reason: string,
): OsNotificationWatcher {
    queueMicrotask(() =>
        listener({
            kind: "error",
            message: reason,
        }),
    );
    return {
        async stop() {
            // Nothing to clean up.
        },
    };
}
