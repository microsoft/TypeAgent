// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StudioEvent } from "@typeagent/core/events";
import type { StudioInfo } from "@typeagent/core/runtime";
import { StudioServiceClient } from "./studioServiceClient.js";

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
 * reads from the `studio` agent's runtime (in the agent-server process) over the
 * typed service channel instead of the extension's in-process runtime.
 *
 * Owns its {@link StudioServiceClient} connection: {@link dispose} closes the
 * socket. A single `subscribeEvents()` is issued at connect time and pushed
 * events are fanned out locally to every {@link onAnyEvent} listener, so adding
 * a listener never re-subscribes on the wire.
 */
export class StudioServiceEventSource implements EventLogSource {
    private constructor(
        private readonly client: StudioServiceClient,
        private readonly listeners: Set<(event: StudioEvent) => void>,
    ) {}

    /**
     * Discover, connect, and subscribe. Returns `undefined` when no studio
     * service is reachable (agent-server down or studio agent disabled) — the
     * caller should stay on / fall back to the in-process runtime.
     *
     * `onClosed` fires once if the connection later drops so the caller can
     * fall back.
     */
    static async connect(options: {
        repoRoot?: string;
        agentServerUrl?: string;
        /** Override discovery with an explicit `ws://host:port` (tests). */
        endpoint?: string;
        onClosed?: () => void;
    }): Promise<StudioServiceEventSource | undefined> {
        const listeners = new Set<(event: StudioEvent) => void>();
        const client = await StudioServiceClient.connect({
            repoRoot: options.repoRoot,
            agentServerUrl: options.agentServerUrl,
            endpoint: options.endpoint,
            onEvent: (event) => {
                for (const listener of listeners) {
                    listener(event);
                }
            },
            onClose: options.onClosed,
        });
        if (client === undefined) {
            return undefined;
        }
        await client.subscribeEvents();
        return new StudioServiceEventSource(client, listeners);
    }

    queryRecentEvents(limit?: number): Promise<StudioEvent[]> {
        return this.client.queryRecentEvents(limit);
    }

    onAnyEvent(listener: (event: StudioEvent) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    /** One-shot service metadata (repo root + agent locations). */
    getStudioInfo(): Promise<StudioInfo> {
        return this.client.getStudioInfo();
    }

    dispose(): void {
        this.listeners.clear();
        this.client.close();
    }
}
