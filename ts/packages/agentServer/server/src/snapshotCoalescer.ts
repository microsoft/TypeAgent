// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { QueueSnapshot } from "@typeagent/dispatcher-types";

/**
 * Coalesces `queueStateChanged` snapshot broadcasts: at most one
 * snapshot per `windowMs` window goes out on the wire, and the
 * **last** snapshot in that window is the one delivered. Used to
 * keep event volume bounded under bursty submits without losing
 * visibility into the final state.
 *
 * The `version` watermark on each snapshot means clients can safely
 * ignore stale broadcasts even if they slip through; this coalescer
 * exists for bandwidth and CPU, not correctness.
 *
 * See messageQueueing.md §8.2.
 */
export interface SnapshotCoalescer {
    /** Schedule (or replace) the next snapshot to broadcast. */
    schedule(snapshot: QueueSnapshot): void;
    /** Flush any pending snapshot immediately (used on shutdown). */
    flush(): void;
}

export function createSnapshotCoalescer(
    emit: (snapshot: QueueSnapshot) => void,
    windowMs: number = 100,
): SnapshotCoalescer {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: QueueSnapshot | null = null;

    const fire = (): void => {
        timer = null;
        const s = pending;
        pending = null;
        if (s !== null) emit(s);
    };

    return {
        schedule(snapshot: QueueSnapshot): void {
            pending = snapshot;
            if (timer !== null) return;
            timer = setTimeout(fire, windowMs);
            timer.unref?.();
        },
        flush(): void {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            const s = pending;
            pending = null;
            if (s !== null) emit(s);
        },
    };
}
