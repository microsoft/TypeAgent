// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { QueuedRequest, QueueSnapshot } from "./queue.js";

/**
 * Client-side mirror of the server's per-conversation queue. Owns the
 * snapshot field, the monotonic version watermark, and the policy that drops
 * stale push events from out-of-order delivery. Pure data: no I/O, no DOM,
 * no console — callers wire returned values to their own UI affordances.
 *
 * Lifecycle:
 *   1. `reset(snapshot)` on bootstrap (e.g. `JoinConversationResult.queueSnapshot`)
 *      or after disconnect (`reset(undefined)`).
 *   2. `applyQueued` / `applyStarted` / `applyCancelled` on fine-grained push
 *      events; each returns `admitted` and any data the caller needs for UI
 *      side effects (e.g. the previously-running entry, the cancelled text).
 *   3. `applyQueueStateChanged` on the authoritative coalesced snapshot; the
 *      `previous` field lets callers diff to clear stale UI.
 *
 * Admission policy: strict `<` against the watermark. Equal versions are
 * admitted so a paired same-version `queueStateChanged` reconciles after each
 * fine-grained event.
 */
export class QueueStateMirror {
    private _snapshot: QueueSnapshot | undefined;
    private _lastAppliedVersion = -1;

    public get snapshot(): QueueSnapshot | undefined {
        return this._snapshot;
    }

    public get lastAppliedVersion(): number {
        return this._lastAppliedVersion;
    }

    /**
     * Bootstrap from an authoritative snapshot, or clear after disconnect.
     * Resets the version watermark so subsequent push events are admitted.
     */
    public reset(snapshot: QueueSnapshot | undefined): void {
        this._snapshot = snapshot ? cloneQueueSnapshot(snapshot) : undefined;
        this._lastAppliedVersion =
            snapshot && typeof snapshot.version === "number"
                ? snapshot.version
                : -1;
    }

    public applyQueued(
        entry: QueuedRequest,
        version: number | undefined,
    ): ApplyResult {
        if (!this.admitVersion(version)) return { admitted: false };
        const snap = this.ensureSnapshot();
        if (!snap.queued.some((e) => e.requestId === entry.requestId)) {
            snap.queued.push({ ...entry });
        }
        return { admitted: true };
    }

    public applyStarted(
        entry: QueuedRequest,
        version: number | undefined,
    ): ApplyStartedResult {
        if (!this.admitVersion(version)) return { admitted: false };
        const snap = this.ensureSnapshot();
        snap.queued = snap.queued.filter(
            (e) => e.requestId !== entry.requestId,
        );
        // Coalescer note: the trailing `running:null` snapshot for the
        // previously-running entry is often merged with this `started`
        // broadcast. Surface the prior entry so callers can clear its UI;
        // otherwise intermediate items would stay stuck on "running".
        const prevRunning =
            snap.running && snap.running.requestId !== entry.requestId
                ? snap.running
                : undefined;
        snap.running = { ...entry };
        return { admitted: true, previousRunning: prevRunning };
    }

    public applyCancelled(
        requestId: string,
        version: number | undefined,
    ): ApplyCancelledResult {
        if (!this.admitVersion(version)) return { admitted: false };
        if (!this._snapshot) return { admitted: true };
        if (this._snapshot.running?.requestId === requestId) {
            const text = this._snapshot.running.text;
            this._snapshot.running = null;
            return { admitted: true, cancelledText: text };
        }
        const idx = this._snapshot.queued.findIndex(
            (e) => e.requestId === requestId,
        );
        if (idx >= 0) {
            const [removed] = this._snapshot.queued.splice(idx, 1);
            return { admitted: true, cancelledText: removed.text };
        }
        return { admitted: true };
    }

    public applyQueueStateChanged(
        snapshot: QueueSnapshot,
    ): ApplyQueueStateChangedResult {
        if (!this.admitVersion(snapshot.version)) return { admitted: false };
        const previous = this._snapshot;
        this._snapshot = cloneQueueSnapshot(snapshot);
        return { admitted: true, previous };
    }

    /**
     * Admit `version` if not strictly older than the watermark. Same-version
     * events are admitted so an authoritative `queueStateChanged` can overwrite
     * a paired fine-grained event. Undefined versions are always admitted
     * (defensive: some legacy paths may omit a version).
     */
    private admitVersion(version: number | undefined): boolean {
        if (typeof version !== "number") return true;
        if (version < this._lastAppliedVersion) return false;
        this._lastAppliedVersion = version;
        return true;
    }

    private ensureSnapshot(): QueueSnapshot {
        if (!this._snapshot) {
            this._snapshot = {
                running: null,
                queued: [],
                paused: false,
                version: this._lastAppliedVersion,
            };
        }
        return this._snapshot;
    }
}

export interface ApplyResult {
    /** True if the event passed the version watermark and was applied. */
    admitted: boolean;
}

export interface ApplyStartedResult extends ApplyResult {
    /**
     * When admitted: the entry that was running before this transition (if
     * different). Surface for callers to clear stale UI; the coalescer often
     * merges the prior entry's `running:null` snapshot with this event.
     */
    previousRunning?: QueuedRequest | undefined;
}

export interface ApplyCancelledResult extends ApplyResult {
    /**
     * When admitted and the cancelled entry was found in the snapshot: its
     * raw text. Used by clients that print a "cancelled: <text>" affordance.
     */
    cancelledText?: string | undefined;
}

export interface ApplyQueueStateChangedResult extends ApplyResult {
    /**
     * When admitted: the snapshot in effect immediately before the swap
     * (already a clone — safe to retain). Used to diff for UI cleanup.
     */
    previous?: QueueSnapshot | undefined;
}

/**
 * Deep-clone a `QueueSnapshot` so the caller can mutate freely without
 * aliasing the server's broadcast copy. Includes `pauseReason` (which the
 * legacy per-client clones in `ChatView`/`enhancedConsole` dropped — picking
 * it up here is additive and strictly more correct).
 */
export function cloneQueueSnapshot(snap: QueueSnapshot): QueueSnapshot {
    const cloned: QueueSnapshot = {
        running: snap.running ? { ...snap.running } : null,
        queued: snap.queued.map((e) => ({ ...e })),
        paused: snap.paused,
        version: snap.version,
    };
    // `pauseReason` is optional under exactOptionalPropertyTypes; only attach
    // when present so we don't widen the property to `undefined`.
    if (snap.pauseReason !== undefined) {
        cloned.pauseReason = snap.pauseReason;
    }
    return cloned;
}
