// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Default half-life for a memory's salience: 14 days. */
export const DEFAULT_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

function lambdaForHalfLife(halfLifeMs: number): number {
    return Math.LN2 / halfLifeMs;
}

interface SignalState {
    base: number; // strength at lastSeen
    lastSeen: number; // epoch ms
    lambda: number; // decay rate per ms
    pinned: boolean;
    accessCount: number;
}

/**
 * Tracks the time-varying salience of each memory using LAZY exponential decay:
 * nothing is written on a timer. The decayed value is computed on read as
 * `base * exp(-lambda * (now - lastSeen))`. On reinforcement we first decay the
 * base forward to now, add the increment, and reset lastSeen — so the stored
 * value is always the strength at its own lastSeen. Pinned memories never decay.
 *
 * This is what keeps memory clean over time without a sweep: stale, unused
 * memories fade in ranking while reinforced or pinned ones stay strong.
 */
export class SignalStore {
    private readonly states = new Map<string, SignalState>();
    private readonly defaultLambda: number;

    constructor(halfLifeMs: number = DEFAULT_HALF_LIFE_MS) {
        this.defaultLambda = lambdaForHalfLife(halfLifeMs);
    }

    ensure(id: string, initial: number, now: number): void {
        if (this.states.has(id)) {
            return;
        }
        this.states.set(id, {
            base: initial,
            lastSeen: now,
            lambda: this.defaultLambda,
            pinned: false,
            accessCount: 0,
        });
    }

    /** Current decayed strength. Returns 0 for unknown ids. */
    strength(id: string, now: number): number {
        const s = this.states.get(id);
        if (!s) {
            return 0;
        }
        if (s.pinned) {
            return s.base;
        }
        const dt = Math.max(0, now - s.lastSeen);
        return s.base * Math.exp(-s.lambda * dt);
    }

    /** Decay forward to `now`, add `amount`, reset lastSeen. */
    reinforce(id: string, amount: number, now: number): void {
        const s = this.states.get(id);
        if (!s) {
            this.ensure(id, amount, now);
            const created = this.states.get(id)!;
            created.accessCount = 1;
            return;
        }
        const decayed = this.strength(id, now);
        s.base = decayed + amount;
        s.lastSeen = now;
        s.accessCount += 1;
    }

    pin(id: string, now: number): void {
        const s = this.states.get(id);
        if (!s) {
            this.ensure(id, 1, now);
            this.states.get(id)!.pinned = true;
            return;
        }
        // Freeze at the current decayed value so pinning doesn't inflate it.
        s.base = this.strength(id, now);
        s.lastSeen = now;
        s.pinned = true;
    }

    unpin(id: string, now: number): void {
        const s = this.states.get(id);
        if (!s) {
            return;
        }
        s.pinned = false;
        s.lastSeen = now;
    }

    isPinned(id: string): boolean {
        return this.states.get(id)?.pinned ?? false;
    }

    accessCount(id: string): number {
        return this.states.get(id)?.accessCount ?? 0;
    }

    has(id: string): boolean {
        return this.states.has(id);
    }
}
