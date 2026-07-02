// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface BackoffOptions {
    /** Delay before the first retry and the growth base, in milliseconds. */
    baseMs: number;
    /** Upper bound applied to every delay, in milliseconds. */
    maxMs: number;
}

export interface Backoff {
    /** Delay (ms) to wait for the current attempt, then advance the counter. */
    next(): number;
    /** Reset to the first attempt — call once a connection succeeds. */
    reset(): void;
    /** Number of attempts taken since construction or the last {@link reset}. */
    readonly attempt: number;
}

/**
 * Exponential backoff with a ceiling. Successive delays double from `baseMs`
 * (`baseMs`, `2·baseMs`, `4·baseMs`, …) and are clamped to `maxMs`, so a peer
 * that stays down settles into steady retries at the cap instead of either
 * hammering it or waiting ever-longer. Calling {@link Backoff.reset} after a
 * successful connect makes the next outage start quickly from `baseMs` again.
 */
export function createBackoff({ baseMs, maxMs }: BackoffOptions): Backoff {
    let attempt = 0;
    return {
        next(): number {
            const delay = Math.min(maxMs, baseMs * 2 ** attempt);
            attempt += 1;
            return delay;
        },
        reset(): void {
            attempt = 0;
        },
        get attempt(): number {
            return attempt;
        },
    };
}
