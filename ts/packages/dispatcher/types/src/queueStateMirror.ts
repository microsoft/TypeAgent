// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { QueuedRequest, QueueSnapshot } from "./queue.js";

/**
 * Client-side mirror of the server's per-conversation queue. Pure data —
 * callers wire returned values to their own UI. Admission policy: strict
 * `<` against the version watermark, so a paired same-version snapshot
 * still reconciles after each fine-grained event.
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

    /** Bootstrap from a snapshot, or clear after disconnect. */
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
        // Surface prior running entry so callers can clear its UI: the coalescer
        // often merges the previous `running:null` snapshot into this started event.
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

    // Equal versions are admitted so an authoritative `queueStateChanged` can
    // overwrite a paired fine-grained event. Undefined versions always admitted.
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
    admitted: boolean;
}

export interface ApplyStartedResult extends ApplyResult {
    /** Prior running entry, when different from the new one (for UI cleanup). */
    previousRunning?: QueuedRequest | undefined;
}

export interface ApplyCancelledResult extends ApplyResult {
    /** Raw text of the cancelled entry, if it was in the snapshot. */
    cancelledText?: string | undefined;
}

export interface ApplyQueueStateChangedResult extends ApplyResult {
    /** Snapshot in effect before the swap (cloned — safe to retain). */
    previous?: QueueSnapshot | undefined;
}

/** Deep-clone a `QueueSnapshot` so callers can mutate freely. */
export function cloneQueueSnapshot(snap: QueueSnapshot): QueueSnapshot {
    const cloned: QueueSnapshot = {
        running: snap.running ? { ...snap.running } : null,
        queued: snap.queued.map((e) => ({ ...e })),
        paused: snap.paused,
        version: snap.version,
    };
    if (snap.pauseReason !== undefined) {
        cloned.pauseReason = snap.pauseReason;
    }
    return cloned;
}
