// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { QueueSnapshot } from "@typeagent/dispatcher-types";

/**
 * Coalesces `queueStateChanged` broadcasts: at most one snapshot per `windowMs`,
 * with the last snapshot in the window delivered. Keeps event volume bounded
 * under bursty submits. Version-stamped snapshots make this safe for bandwidth
 * (not correctness — stale broadcasts can be ignored client-side).
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
