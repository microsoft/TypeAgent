// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StudioEvent } from "@typeagent/core/events";
import type { StudioServiceConnection } from "./studioServiceConnection.js";

/**
 * The minimal read+subscribe surface the Event Log tree needs. Both the
 * in-process `StudioRuntime` (structurally) and the channel-backed
 * {@link StudioServiceEventSource} conform, so the tree can swap between them.
 */
export interface EventLogSource {
    /** Recent events, oldest-first, bounded by `limit`. */
    queryRecentEvents(limit?: number): Promise<StudioEvent[]>;
    /** Subscribe to every event as it is emitted. Returns a disposable. */
    onAnyEvent(listener: (event: StudioEvent) => void): { dispose(): void };
}

/**
 * Channel-backed {@link EventLogSource}: the Option-B path where the Event Log
 * reads from the `studio` agent's runtime over the shared service connection
 * instead of the extension's in-process runtime. A thin adapter — the shared
 * {@link StudioServiceConnection} owns the socket, the single subscription, and
 * the event fanout; this returns empty when the connection is momentarily down
 * (the coordinator swaps back to the in-process runtime on disconnect anyway).
 */
export class StudioServiceEventSource implements EventLogSource {
    constructor(private readonly connection: StudioServiceConnection) {}

    queryRecentEvents(limit?: number): Promise<StudioEvent[]> {
        const client = this.connection.getClient();
        return client ? client.queryRecentEvents(limit) : Promise.resolve([]);
    }

    onAnyEvent(listener: (event: StudioEvent) => void): { dispose(): void } {
        return this.connection.onEvent(listener);
    }
}
