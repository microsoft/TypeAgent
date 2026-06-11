// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import {
    EVENT_SCHEMA_VERSION,
    EventFilter,
    EventStreamVersions,
    StudioEvent,
    SUPPORTED_EVENT_TYPES,
    eventMatchesFilter,
} from "./types.js";

const debug = registerDebug("typeagent:studio:events");

/* -------------------------------------------------------------------------- */
/* Public interfaces                                                           */
/* -------------------------------------------------------------------------- */

export interface EventSubscription {
    /** Stop receiving events. Idempotent. */
    unsubscribe(): void;
}

export interface SubscribeOptions {
    filter?: EventFilter;
    /**
     * When set, events are delivered asynchronously via microtask scheduling
     * through a bounded per-subscription queue of this size. If the sink can't
     * keep up and the queue fills, new events are dropped and the cumulative
     * dropped-count is reported via `onDropped` at the next successful delivery.
     *
     * When unset (default), events are delivered synchronously inside `emit()`.
     * Sinks that throw are logged and skipped; they do not stop other sinks.
     */
    bufferSize?: number;
    onDropped?: (count: number) => void;
}

export interface QueryOptions {
    /** Inclusive epoch-ms lower bound. */
    since?: number;
    /** Inclusive epoch-ms upper bound. */
    until?: number;
    filter?: EventFilter;
}

/** Read interface — what consumers see. */
export interface EventStream {
    subscribe(
        sink: (event: StudioEvent) => void,
        opts?: SubscribeOptions,
    ): EventSubscription;
    query(opts?: QueryOptions): AsyncIterable<StudioEvent>;
    versions(): EventStreamVersions;
}

/** Write interface — what emitters call. Split from the read interface so we
 *  can hand a read-only `EventStream` to consumers. */
export interface EventEmitterLike {
    emit(event: StudioEvent): void;
}

/* -------------------------------------------------------------------------- */
/* In-process implementation                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Default ring-buffer capacity. See implementation plan §2.5 D2 (open decision).
 * 10_000 is the recommended default for MVP; per-workspace override is possible
 * once we wire configuration in P-1.
 */
export const DEFAULT_BUFFER_CAPACITY = 10_000;

interface InternalSubscription {
    filter?: EventFilter;
    sink: (event: StudioEvent) => void;
    bufferSize?: number;
    onDropped?: (count: number) => void;
    queue?: StudioEvent[];
    droppedSinceLastDeliver: number;
    flushScheduled: boolean;
    closed: boolean;
}

export interface InProcessEventStreamOptions {
    bufferCapacity?: number;
}

export class InProcessEventStream implements EventStream, EventEmitterLike {
    private readonly buffer: StudioEvent[] = [];
    private readonly bufferCapacity: number;
    private readonly subs = new Set<InternalSubscription>();

    constructor(opts: InProcessEventStreamOptions = {}) {
        this.bufferCapacity = opts.bufferCapacity ?? DEFAULT_BUFFER_CAPACITY;
        if (this.bufferCapacity <= 0) {
            throw new Error("bufferCapacity must be positive");
        }
    }

    /* ------------------------- Write side ------------------------- */

    emit(event: StudioEvent): void {
        // Append to ring buffer.
        this.buffer.push(event);
        if (this.buffer.length > this.bufferCapacity) {
            this.buffer.splice(0, this.buffer.length - this.bufferCapacity);
        }
        // Deliver to matching subs.
        for (const sub of this.subs) {
            if (sub.closed) continue;
            if (!eventMatchesFilter(event, sub.filter)) continue;
            if (sub.bufferSize !== undefined && sub.queue !== undefined) {
                this.enqueueBuffered(sub, event);
            } else {
                this.deliverSync(sub, event);
            }
        }
    }

    private deliverSync(sub: InternalSubscription, event: StudioEvent): void {
        try {
            sub.sink(event);
        } catch (err) {
            debug("sink threw during sync delivery: %O", err);
        }
    }

    private enqueueBuffered(
        sub: InternalSubscription,
        event: StudioEvent,
    ): void {
        const q = sub.queue!;
        if (q.length >= (sub.bufferSize ?? 0)) {
            sub.droppedSinceLastDeliver++;
            return;
        }
        q.push(event);
        if (!sub.flushScheduled) {
            sub.flushScheduled = true;
            queueMicrotask(() => this.flushBuffered(sub));
        }
    }

    private flushBuffered(sub: InternalSubscription): void {
        sub.flushScheduled = false;
        if (sub.closed) return;
        const q = sub.queue;
        if (!q) return;
        while (q.length > 0) {
            const evt = q.shift()!;
            try {
                sub.sink(evt);
            } catch (err) {
                debug("sink threw during buffered delivery: %O", err);
            }
        }
        if (sub.droppedSinceLastDeliver > 0 && sub.onDropped) {
            const count = sub.droppedSinceLastDeliver;
            sub.droppedSinceLastDeliver = 0;
            try {
                sub.onDropped(count);
            } catch (err) {
                debug("onDropped threw: %O", err);
            }
        }
    }

    /* ------------------------- Read side -------------------------- */

    subscribe(
        sink: (event: StudioEvent) => void,
        opts: SubscribeOptions = {},
    ): EventSubscription {
        const sub: InternalSubscription = {
            sink,
            droppedSinceLastDeliver: 0,
            flushScheduled: false,
            closed: false,
        };
        if (opts.filter !== undefined) {
            sub.filter = opts.filter;
        }
        if (opts.bufferSize !== undefined) {
            if (opts.bufferSize <= 0) {
                throw new Error("bufferSize must be positive when provided");
            }
            sub.bufferSize = opts.bufferSize;
            sub.queue = [];
        }
        if (opts.onDropped !== undefined) {
            sub.onDropped = opts.onDropped;
        }
        this.subs.add(sub);
        return {
            unsubscribe: () => {
                sub.closed = true;
                this.subs.delete(sub);
            },
        };
    }

    async *query(opts: QueryOptions = {}): AsyncIterable<StudioEvent> {
        const since = opts.since;
        const until = opts.until;
        const filter = opts.filter;
        // Snapshot the buffer so concurrent emits during iteration don't
        // confuse callers. Snapshot is cheap; this is in-memory.
        const snapshot = [...this.buffer];
        for (const event of snapshot) {
            if (since !== undefined && event.ts < since) continue;
            if (until !== undefined && event.ts > until) continue;
            if (!eventMatchesFilter(event, filter)) continue;
            yield event;
        }
    }

    versions(): EventStreamVersions {
        return {
            schemaVersion: EVENT_SCHEMA_VERSION,
            supportedEventTypes: [...SUPPORTED_EVENT_TYPES],
        };
    }

    /* -------------------- Test / debug helpers -------------------- */

    /** Number of currently-active subscriptions. Test-only helper. */
    subscriptionCount(): number {
        return this.subs.size;
    }

    /** Number of events currently held in the ring buffer. Test-only helper. */
    bufferedCount(): number {
        return this.buffer.length;
    }
}
