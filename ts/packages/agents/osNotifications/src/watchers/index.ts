// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    OsNotificationListener,
    OsNotificationWatcher,
} from "../watcherProtocol.js";
import { startNoopWatcher } from "./noopWatcher.js";

export async function startWatcher(
    platform: NodeJS.Platform,
    listener: OsNotificationListener,
): Promise<OsNotificationWatcher> {
    switch (platform) {
        case "win32": {
            const { startWindowsWatcher } = await import("./windowsWatcher.js");
            return startWindowsWatcher(listener);
        }
        case "linux": {
            const { startLinuxWatcher } = await import("./linuxWatcher.js");
            return startLinuxWatcher(listener);
        }
        case "darwin":
            return startNoopWatcher(
                listener,
                "OS notification forwarding is not supported on macOS — Apple does not expose other apps' notifications via a public API.",
            );
        default:
            return startNoopWatcher(
                listener,
                `OS notification forwarding is not supported on platform '${platform}'.`,
            );
    }
}
