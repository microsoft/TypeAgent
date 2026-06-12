// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StudioEvent } from "@typeagent/core/events";
import { StudioServiceClient } from "./studioServiceClient.js";

export type StudioConnectionState =
    | "disconnected"
    | "connecting"
    | "connected";

/**
 * One shared connection to the `studio` service channel for all of the
 * extension's channel-backed surfaces (Event Log, Collisions, and — as the
 * migration proceeds — Sandboxes). It owns a single {@link StudioServiceClient}
 * (so `@system ports` shows one client per extension, not one per view),
 * subscribes once, and fans the `studioEvent` push out to every registered
 * listener.
 *
 * It auto-connects with backoff (the agent-server typically starts after the
 * extension) and reconnects on drop. Connect attempts are single-flight and
 * fenced by a monotonic generation so overlapping activation / manual / retry
 * attempts and stale close handlers can't corrupt state.
 *
 * Heavy/long operations (e.g. the Impact Report's replay) keep their own
 * dedicated client — this connection is for the always-on views.
 */
export class StudioServiceConnection {
    private client: StudioServiceClient | undefined;
    private state: StudioConnectionState = "disconnected";
    private generation = 0;
    private connecting: Promise<boolean> | undefined;
    private retryTimer: ReturnType<typeof setTimeout> | undefined;
    private retryAttempt = 0;
    private autoRetry = false;
    private disposed = false;
    private readonly eventListeners = new Set<(event: StudioEvent) => void>();
    private readonly stateListeners = new Set<
        (state: StudioConnectionState) => void
    >();

    private readonly backoffMs: number[];

    constructor(
        private readonly repoRoot: string | undefined,
        private readonly options: {
            /** Retry backoff in ms, capped at the last value. */
            backoffMs?: number[];
            /** Explicit `ws://host:port` (tests); bypasses discovery. */
            endpoint?: string;
        } = {},
    ) {
        this.backoffMs = options.backoffMs ?? [2000, 4000, 8000, 15000];
    }

    get currentState(): StudioConnectionState {
        return this.state;
    }

    /** The live client, or `undefined` when not connected. */
    getClient(): StudioServiceClient | undefined {
        return this.client;
    }

    /** Subscribe to every pushed `studioEvent`. */
    onEvent(listener: (event: StudioEvent) => void): { dispose(): void } {
        this.eventListeners.add(listener);
        return { dispose: () => this.eventListeners.delete(listener) };
    }

    /** Subscribe to connection-state changes (fires immediately with current). */
    onStateChanged(listener: (state: StudioConnectionState) => void): {
        dispose(): void;
    } {
        this.stateListeners.add(listener);
        listener(this.state);
        return { dispose: () => this.stateListeners.delete(listener) };
    }

    /** Begin auto-connecting (and auto-reconnecting) until disposed. */
    startAutoConnect(): void {
        this.autoRetry = true;
        void this.connect();
    }

    /**
     * Attempt to connect now (single-flight). Resolves true once connected.
     * Re-enables auto-retry so a manual connect also resumes reconnection.
     */
    connect(): Promise<boolean> {
        this.autoRetry = true;
        if (this.disposed) {
            return Promise.resolve(false);
        }
        if (this.client) {
            return Promise.resolve(true);
        }
        if (this.connecting) {
            return this.connecting;
        }
        this.cancelRetry();
        const gen = ++this.generation;
        this.setState("connecting");
        this.connecting = (async () => {
            const client = await StudioServiceClient.connect({
                ...(this.repoRoot !== undefined
                    ? { repoRoot: this.repoRoot }
                    : {}),
                ...(this.options.endpoint !== undefined
                    ? { endpoint: this.options.endpoint }
                    : {}),
                onEvent: (event) => this.fanout(event),
                onClose: () => this.handleClose(gen),
            });
            // Superseded (disposed or a newer attempt won) — drop this client.
            if (this.disposed || gen !== this.generation) {
                client?.close();
                return this.client !== undefined;
            }
            if (client === undefined) {
                this.setState("disconnected");
                this.scheduleRetry();
                return false;
            }
            this.client = client;
            try {
                await client.subscribeEvents();
            } catch {
                // Subscribed-failure: treat as a drop and retry.
                client.close();
                this.client = undefined;
                this.setState("disconnected");
                this.scheduleRetry();
                return false;
            }
            this.retryAttempt = 0;
            this.setState("connected");
            return true;
        })().finally(() => {
            this.connecting = undefined;
        });
        return this.connecting;
    }

    private handleClose(gen: number): void {
        if (gen !== this.generation || this.disposed) {
            return; // a stale client closing, or we're shutting down
        }
        this.client = undefined;
        this.setState("disconnected");
        if (this.autoRetry) {
            this.scheduleRetry();
        }
    }

    private scheduleRetry(): void {
        if (this.disposed || this.retryTimer !== undefined || !this.autoRetry) {
            return;
        }
        const delay =
            this.backoffMs[
                Math.min(this.retryAttempt, this.backoffMs.length - 1)
            ];
        this.retryAttempt += 1;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            void this.connect();
        }, delay);
    }

    private cancelRetry(): void {
        if (this.retryTimer !== undefined) {
            clearTimeout(this.retryTimer);
            this.retryTimer = undefined;
        }
    }

    private fanout(event: StudioEvent): void {
        // Copy + isolate: one slow/throwing listener must not block the rest.
        for (const listener of [...this.eventListeners]) {
            try {
                listener(event);
            } catch {
                // Swallow — a listener error shouldn't break the event stream.
            }
        }
    }

    private setState(state: StudioConnectionState): void {
        if (state === this.state) {
            return;
        }
        this.state = state;
        for (const listener of [...this.stateListeners]) {
            try {
                listener(state);
            } catch {
                // Swallow.
            }
        }
    }

    dispose(): void {
        this.disposed = true;
        this.generation++;
        this.cancelRetry();
        this.client?.close();
        this.client = undefined;
        this.eventListeners.clear();
        this.stateListeners.clear();
    }
}
