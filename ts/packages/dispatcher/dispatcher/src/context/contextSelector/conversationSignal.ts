// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The conversation signal (§7–8): the data half of contextSelector. Produces a
// ContextVector — a decayed keyword-frequency map of the recent conversation —
// which the scorer (§9) ranks candidates against. Kept behind a small interface
// so v1's raw-token ring buffer can be swapped for v2's knowPro topics/entities
// without touching the scorer or decision rule (the source seam, §7.3).

import { tokenize } from "./tokenize.js";

// { canonical token -> decay-weighted conversational frequency }. The single
// shape both the v1 raw-token source and the v2 knowPro source project into, and
// the only conversation input the scorer sees (§9). The v2 knowPro source
// projects its topics / entity names+types into these same canonical string keys
// (design §9 step 2 — "project into the same { key -> weight } map"); a richer
// entity-structure-aware or embedding scorer is the one flagged future that would
// extend this shape, not v1.
export type ContextVector = ReadonlyMap<string, number>;

// The seam. A source owns whatever conversational state it needs and exposes it
// only as a ContextVector; the scorer never learns which implementation is
// behind it.
export interface ConversationSignalSource {
    // Ingest one completed user turn. Called once per turn at an ungated point
    // (§7.2). Implementations that read from an external store (knowPro) may
    // treat this as a no-op.
    recordRequest(request: string): void;
    // The current decayed context vector, history-only — it must reflect turns
    // *before* the request now being routed (§10). The v1 source guarantees this
    // by recording each turn only after it completes.
    getContextVector(): ContextVector;
    // Invalidation hook — `@history clear`, session switch (§7.2, §12).
    reset(): void;
}

// Windowing/decay knobs (§8). A shape, not the session type, so the source stays
// decoupled and unit-testable.
export type SignalConfig = {
    // Ring-buffer look-back N (default 20).
    windowTurns: number;
    // Per-turn recency decay lambda (default 0.9).
    decay: number;
    // Suppress negated content words from the context vector (§7). Optional so
    // test constructors and non-signal callers stay simple; treated as off when
    // unset. Production enables it via the contextSelector config default.
    negationGuard?: boolean;
};

// V1 source (§7.2): a contextSelector-owned ring buffer of recent raw user
// requests, tokenized + recency-decayed into the context vector on demand. The
// only user-words signal available in agent-server mode (`ChatHistory` is empty
// there, §7.1). Deterministic: a pure function of the request sequence and the
// config, with no wall-clock input (§12).
export class RingBufferSignalSource implements ConversationSignalSource {
    private readonly buffer: string[] = [];

    // `getConfig` is read on every call so runtime `@config` edits to windowTurns
    // / decay take effect immediately.
    constructor(private readonly getConfig: () => SignalConfig) {}

    private cap(): number {
        return Math.max(1, Math.floor(this.getConfig().windowTurns));
    }

    public recordRequest(request: string): void {
        const trimmed = request.trim();
        if (trimmed.length === 0) {
            return;
        }
        this.buffer.push(trimmed);
        const cap = this.cap();
        if (this.buffer.length > cap) {
            this.buffer.splice(0, this.buffer.length - cap);
        }
    }

    // Sum each buffered turn's tokens weighted by lambda^age, age = turns ago.
    // The buffer holds only prior turns (the current one is recorded after it
    // completes), so the newest buffered turn is age 1 — history-only by
    // construction (§10, §14).
    public getContextVector(): ContextVector {
        const { decay, negationGuard } = this.getConfig();
        const cap = this.cap();
        const start = Math.max(0, this.buffer.length - cap);
        const turns = this.buffer.slice(start);
        const len = turns.length;
        const tokenizeOptions = negationGuard
            ? { dropNegatedSpans: true }
            : undefined;
        const vector = new Map<string, number>();
        for (let i = 0; i < len; i++) {
            const age = len - i;
            const weight = Math.pow(decay, age);
            for (const token of tokenize(turns[i], tokenizeOptions)) {
                vector.set(token, (vector.get(token) ?? 0) + weight);
            }
        }
        return vector;
    }

    public reset(): void {
        this.buffer.length = 0;
    }

    // Inspection hooks (telemetry / tests). Not part of the seam.
    public get size(): number {
        return this.buffer.length;
    }

    public snapshot(): readonly string[] {
        return [...this.buffer];
    }
}
