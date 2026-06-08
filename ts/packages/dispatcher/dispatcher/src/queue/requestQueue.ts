// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import type {
    CancelResult,
    CommandResult,
    ProcessCommandOptions,
    QueueCancelReason,
    QueuedRequest,
    QueueSnapshot,
} from "@typeagent/dispatcher-types";
import {
    QueueFullError,
    ServerStoppingError,
} from "@typeagent/dispatcher-types";

import registerDebug from "debug";
const debug = registerDebug("typeagent:requestQueue");
const debugInternal = registerDebug("agent-dispatcher:requestQueue");

/** Hard cap on running + queued entries; submits beyond this throw QueueFullError. */
export const MAX_QUEUE_DEPTH = 100;

/** Default deadline (ms) for `drainAndStop` before entries are forcibly abandoned. */
export const SHUTDOWN_DRAIN_DEADLINE_MS = 30_000;

/**
 * Push channel for lifecycle events. The Dispatcher wires this to its host's
 * `ClientIO`; multi-client fan-out is the wrapper's job (see SharedDispatcher).
 * Each event carries the queue's monotonic `version`.
 */
export interface QueueBroadcaster {
    requestQueued(entry: QueuedRequest, version: number): void;
    requestStarted(entry: QueuedRequest, version: number): void;
    requestCancelled(
        requestId: string,
        reason: QueueCancelReason,
        version: number,
    ): void;
    queueStateChanged(snapshot: QueueSnapshot): void;
}

/** Optional telemetry sink. */
export interface QueueLogger {
    logEvent(name: string, data: unknown): void;
}

/**
 * Drain-loop invocation surface. Passing a function (not a Dispatcher) prevents
 * accidental re-entry into the queuing wrapper. Receives raw attachments;
 * broadcast redaction happens elsewhere.
 */
export interface QueueExecutionContext {
    requestId: string;
    originatorConnectionId: string;
    text: string;
    clientRequestId?: unknown;
    attachments?: string[];
    options?: ProcessCommandOptions;
}
export type InnerProcessCommand = (
    ctx: QueueExecutionContext,
) => Promise<CommandResult | undefined>;

/** Inputs accepted by `RequestQueue.submit`. */
export interface QueueSubmitInput {
    text: string;
    originatorConnectionId: string;
    attachments?: string[];
    options?: ProcessCommandOptions;
    clientRequestId?: unknown;
    /** Optional caller-supplied id. Defaults to a fresh UUID when omitted. */
    requestId?: string;
}

/**
 * Internal extension of `QueuedRequest` carrying completion plumbing the drain
 * loop resolves on terminal state.
 */
interface InternalEntry extends QueuedRequest {
    completion: Promise<CommandResult | undefined>;
    resolveCompletion: (result: CommandResult | undefined) => void;
    rejectCompletion: (err: unknown) => void;
    settled: boolean;
    /**
     * Reference count for overlapping `blockedOn: "interaction"` holds (e.g.
     * `await Promise.all([question, proposeAction])`). The wire `blockedOn`
     * field is derived from `blockedOnDepth > 0` in {@link RequestQueue.publicCopy}.
     */
    blockedOnDepth: number;
    /**
     * Reason captured by {@link RequestQueue.cancelRunning}; preserved by the
     * drain loop so the wire `error` reads `cancelled:<reason>` consistently
     * across queued/running cancel paths.
     */
    cancelReason?: QueueCancelReason;
}

/**
 * Per-conversation request queue owned by the Dispatcher. Replaces implicit
 * serialization-via-`commandLock` with an explicit FIFO pipeline. See
 * `docs/architecture/messageQueueing.md` for the broader design.
 */
export class RequestQueue {
    private readonly tail: InternalEntry[] = [];
    private head: InternalEntry | null = null;
    private draining = false;
    private stopped = false;
    private stoppedResolvers: Array<() => void> = [];
    /** Memoized first-call result; reused so repeated shutdowns don't leak resolvers. */
    private drainAndStopPromise: Promise<void> | null = null;
    /** Set when the shutdown deadline elapses; subsequent submits throw ServerStoppingError. */
    private abandoned = false;
    /**
     * RequestIds cancelled while still queued. The drain loop consults this set
     * after `shift()` to deterministically skip an entry that races past splice.
     */
    private readonly cancelInFlight = new Set<string>();
    /** Monotonically increasing version stamp on every mutation/event/snapshot. */
    private snapshotVersion = 0;

    constructor(
        private readonly innerProcessCommand: InnerProcessCommand,
        private readonly broadcast: QueueBroadcaster,
        private readonly logger?: QueueLogger,
    ) {}

    /** @internal Test-only accessor — DO NOT use in production code. */
    public __testGetCancelInFlightSize(): number {
        return this.cancelInFlight.size;
    }

    /** @internal Test-only accessor for the current version stamp. */
    public __testGetVersion(): number {
        return this.snapshotVersion;
    }

    // ---------- public API ----------

    /**
     * Append a new entry and start the drain loop if idle.
     * @throws QueueFullError when the queue is at `MAX_QUEUE_DEPTH`.
     */
    submit(input: QueueSubmitInput): InternalEntry {
        return this.enqueue(input, "tail");
    }

    /**
     * Steering primitive: prepend an entry so it runs next, ahead of any other
     * queued entries. Used by `Dispatcher.interrupt` together with a cancel of
     * the running entry. Caller owns the cancel; this method only owns the prepend.
     * @throws QueueFullError when the queue is at `MAX_QUEUE_DEPTH`.
     */
    interrupt(input: QueueSubmitInput): InternalEntry {
        return this.enqueue(input, "head");
    }

    private enqueue(
        input: QueueSubmitInput,
        position: "head" | "tail",
    ): InternalEntry {
        if (this.stopped) {
            throw new ServerStoppingError();
        }
        const depth = this.tail.length + (this.head !== null ? 1 : 0);
        if (depth >= MAX_QUEUE_DEPTH) {
            this.log("requestQueue:rejected", {
                connectionId: input.originatorConnectionId,
                reason: "queue_full",
                position,
                depth,
            });
            throw new QueueFullError(MAX_QUEUE_DEPTH);
        }
        const entry = this.materialize(input);
        if (position === "head") {
            this.tail.unshift(entry);
        } else {
            this.tail.push(entry);
        }
        const version = ++this.snapshotVersion;
        this.safeBroadcast("requestQueued", () =>
            this.broadcast.requestQueued(this.publicCopy(entry), version),
        );
        this.safeBroadcast("queueStateChanged", () =>
            this.broadcast.queueStateChanged(this.getSnapshot()),
        );
        this.log(
            position === "head"
                ? "requestQueue:interrupt"
                : "requestQueue:submit",
            {
                requestId: entry.requestId,
                connectionId: entry.originatorConnectionId,
                queuedAhead: position === "head" ? 0 : this.tail.length - 1,
                running: this.head !== null,
                queueDepth: depth + 1,
            },
        );
        void this.maybeDrain();
        return entry;
    }

    /**
     * Remove a queued (not running) entry. Returns true if removed.
     * Cancelling the running entry goes through `cancelRunning` / `Dispatcher.cancelCommand`.
     */
    cancelQueued(requestId: string, reason: QueueCancelReason): boolean {
        const idx = this.tail.findIndex((e) => e.requestId === requestId);
        if (idx < 0) {
            return false;
        }
        // Flag BEFORE splice so any concurrent shifter sees the cancel.
        this.cancelInFlight.add(requestId);
        const [entry] = this.tail.splice(idx, 1);
        this.cancelInFlight.delete(requestId);
        entry.state = "cancelled";
        entry.finishedAt = Date.now();
        entry.error = `cancelled:${reason}`;
        entry.settled = true;
        try {
            entry.resolveCompletion({ cancelled: true });
        } catch {
            // best-effort
        }
        const version = ++this.snapshotVersion;
        this.safeBroadcast("requestCancelled", () =>
            this.broadcast.requestCancelled(entry.requestId, reason, version),
        );
        this.safeBroadcast("queueStateChanged", () =>
            this.broadcast.queueStateChanged(this.getSnapshot()),
        );
        this.log("requestQueue:cancel", {
            requestId: entry.requestId,
            connectionId: entry.originatorConnectionId,
            reason,
            waitMs: entry.finishedAt - entry.submittedAt,
            phase: "queued",
        });
        return true;
    }

    /**
     * Promote a queued (not running) entry to the front of the queue so it
     * runs next, ahead of any other queued entries. Does NOT touch the
     * currently-running head — the promoted entry runs when the head
     * completes. Returns true if the entry was found (and moved, or already
     * at the front); false for the running head or an unknown requestId.
     */
    promote(requestId: string): boolean {
        const idx = this.tail.findIndex((e) => e.requestId === requestId);
        if (idx < 0) {
            return false;
        }
        if (idx === 0) {
            // Already next; nothing to reorder or broadcast.
            return true;
        }
        const [entry] = this.tail.splice(idx, 1);
        this.tail.unshift(entry);
        ++this.snapshotVersion;
        this.safeBroadcast("queueStateChanged", () =>
            this.broadcast.queueStateChanged(this.getSnapshot()),
        );
        this.log("requestQueue:promote", {
            requestId: entry.requestId,
            connectionId: entry.originatorConnectionId,
            fromIndex: idx,
        });
        return true;
    }

    /**
     * Classify a cancel: `"queued"` if a queued entry was removed, `"running"`
     * if the requestId matches the head (caller owns the AbortController),
     * `"not_found"` otherwise.
     */
    classifyCancel(
        requestId: string,
        reason: QueueCancelReason,
    ): "queued" | "running" | "not_found" {
        if (this.cancelQueued(requestId, reason)) {
            return "queued";
        }
        if (this.head?.requestId === requestId) {
            return "running";
        }
        return "not_found";
    }

    /** Synchronous snapshot for `getQueueSnapshot` RPC and `JoinConversationResult.queueSnapshot`. */
    getSnapshot(): QueueSnapshot {
        return {
            running: this.head ? this.publicCopy(this.head) : null,
            queued: this.tail.map((e) => this.publicCopy(e)),
            paused: false,
            version: this.snapshotVersion,
        };
    }

    /** True if the queue has no in-flight or queued entries. */
    isIdle(): boolean {
        return this.head === null && this.tail.length === 0;
    }

    /**
     * Mark the running entry as blocked on an external dependency (currently only
     * `"interaction"`). Reference-counted so overlapping interactions are handled
     * correctly; broadcasts only on the `0 → 1` transition. Pair with {@link markUnblocked}.
     */
    markBlocked(requestId: string, reason: "interaction"): void {
        if (this.head === null || this.head.requestId !== requestId) return;
        void reason;
        this.head.blockedOnDepth += 1;
        if (this.head.blockedOnDepth !== 1) return;
        ++this.snapshotVersion;
        this.safeBroadcast("queueStateChanged", () =>
            this.broadcast.queueStateChanged(this.getSnapshot()),
        );
    }

    /**
     * Decrement the running entry's blocked refcount. Broadcasts only on the
     * `1 → 0` transition. No-op if the head doesn't match or count is zero.
     */
    markUnblocked(requestId: string): void {
        if (this.head === null || this.head.requestId !== requestId) return;
        if (this.head.blockedOnDepth <= 0) return;
        this.head.blockedOnDepth -= 1;
        if (this.head.blockedOnDepth !== 0) return;
        ++this.snapshotVersion;
        this.safeBroadcast("queueStateChanged", () =>
            this.broadcast.queueStateChanged(this.getSnapshot()),
        );
    }

    /**
     * Mark the running head as cancelled and broadcast `requestCancelled` immediately.
     * The entry stays in `head` while the inner dispatcher unwinds; caller must
     * trigger the AbortController separately. The drain loop preserves `cancelReason`
     * so the final wire `error` reads `cancelled:<reason>`.
     *
     * Deliberately does NOT emit a paired `queueStateChanged`: the head's wire
     * `state` is still `"running"`, so a snapshot here would race-resurrect the
     * cancelled entry under strict-`<` version admission. The drain loop's
     * completion broadcast is the authoritative snapshot.
     *
     * Idempotent: returns `false` if the head doesn't match or a reason is already set.
     */
    cancelRunning(requestId: string, reason: QueueCancelReason): boolean {
        if (this.head === null || this.head.requestId !== requestId) {
            return false;
        }
        if (this.head.cancelReason !== undefined) {
            return false;
        }
        this.head.cancelReason = reason;
        const version = ++this.snapshotVersion;
        this.safeBroadcast("requestCancelled", () =>
            this.broadcast.requestCancelled(requestId, reason, version),
        );
        this.log("requestQueue:cancel", {
            requestId,
            connectionId: this.head.originatorConnectionId,
            reason,
            phase: "running",
        });
        return true;
    }

    /**
     * Bounded graceful shutdown. Marks the queue stopped (further `submit`s throw
     * `ServerStoppingError`) and returns a memoized promise that resolves when the
     * queue empties or the deadline elapses. On deadline, in-flight + queued entries
     * are rejected with `ServerStoppingError` and `requestCancelled` is broadcast
     * with reason `"server_stopping"`.
     */
    drainAndStop(
        deadlineMs: number = SHUTDOWN_DRAIN_DEADLINE_MS,
    ): Promise<void> {
        if (this.drainAndStopPromise !== null) {
            return this.drainAndStopPromise;
        }
        this.stopped = true;
        if (this.head === null && this.tail.length === 0) {
            this.drainAndStopPromise = Promise.resolve();
            return this.drainAndStopPromise;
        }
        let settled = false;
        this.drainAndStopPromise = new Promise<void>((resolve) => {
            const finish = () => {
                if (settled) return;
                settled = true;
                if (timer !== undefined) clearTimeout(timer);
                resolve();
            };
            this.stoppedResolvers.push(finish);
            const timer =
                deadlineMs > 0
                    ? setTimeout(() => {
                          this.abandonForShutdown();
                          finish();
                      }, deadlineMs)
                    : undefined;
            timer?.unref?.();
        });
        return this.drainAndStopPromise;
    }

    /** Forcibly settle every entry as `server_stopping`. Idempotent. */
    private abandonForShutdown(): void {
        if (this.abandoned) return;
        this.abandoned = true;
        const reason: QueueCancelReason = "server_stopping";
        const all: InternalEntry[] = [];
        if (this.head !== null) {
            all.push(this.head);
            this.head = null;
        }
        all.push(...this.tail.splice(0));
        for (const entry of all) {
            if (entry.settled) continue;
            entry.settled = true;
            entry.state = "cancelled";
            entry.finishedAt = Date.now();
            entry.error = `cancelled:${reason}`;
            try {
                entry.rejectCompletion(new ServerStoppingError());
            } catch {
                // best-effort
            }
            const version = ++this.snapshotVersion;
            this.safeBroadcast("requestCancelled", () =>
                this.broadcast.requestCancelled(
                    entry.requestId,
                    reason,
                    version,
                ),
            );
        }
        this.safeBroadcast("queueStateChanged", () =>
            this.broadcast.queueStateChanged(this.getSnapshot()),
        );
        this.log("requestQueue:abandoned", {
            count: all.length,
            reason,
        });
    }

    // ---------- internals ----------

    private materialize(input: QueueSubmitInput): InternalEntry {
        const requestId = input.requestId ?? randomUUID();
        let resolveCompletion!: (r: CommandResult | undefined) => void;
        let rejectCompletion!: (err: unknown) => void;
        const completion = new Promise<CommandResult | undefined>(
            (resolve, reject) => {
                resolveCompletion = resolve;
                rejectCompletion = reject;
            },
        );
        const entry: InternalEntry = {
            requestId,
            originatorConnectionId: input.originatorConnectionId,
            text: input.text,
            submittedAt: Date.now(),
            state: "queued",
            completion,
            resolveCompletion,
            rejectCompletion,
            settled: false,
            blockedOnDepth: 0,
        };
        if (input.clientRequestId !== undefined) {
            entry.clientRequestId = input.clientRequestId;
        }
        // `!= null` is intentional — RPC JSON-serializes args and turns trailing
        // `undefined` slots into `null` on the wire.
        if (input.attachments != null) {
            entry.attachments = input.attachments;
            entry.attachmentCount = input.attachments.length;
        }
        if (input.options != null) {
            entry.options = input.options;
        }
        return entry;
    }

    /**
     * Strip internal-only fields and raw attachment bytes before broadcast/snapshot.
     * Wire copy carries `attachmentCount` only — text is intentionally visible
     * because queue steering is the point. `blockedOn` is derived from
     * `blockedOnDepth` so overlapping interactions don't produce a spurious clear.
     */
    private publicCopy(entry: InternalEntry): QueuedRequest {
        const {
            completion: _c,
            resolveCompletion: _r,
            rejectCompletion: _j,
            settled: _s,
            attachments: _a,
            blockedOnDepth: _bod,
            cancelReason: _cr,
            blockedOn: _bo,
            ...pub
        } = entry;
        const out: QueuedRequest = { ...pub };
        out.attachmentCount = entry.attachments?.length ?? 0;
        if (entry.blockedOnDepth > 0) {
            out.blockedOn = "interaction";
        }
        return out;
    }

    private log(name: string, data: unknown): void {
        try {
            debug(name, data);
            debugInternal(name, data);
            this.logger?.logEvent(name, data);
        } catch {
            // best-effort telemetry
        }
    }

    /**
     * Run a broadcaster callback isolated so a single client's failure cannot
     * stall the queue or prevent subsequent broadcasts.
     */
    private safeBroadcast(name: string, fn: () => void): void {
        try {
            fn();
        } catch (e) {
            debug("broadcast:error", { name, error: String(e) });
            debugInternal(`broadcast ${name} threw:`, e);
        }
    }

    private async maybeDrain(): Promise<void> {
        if (this.draining) return;
        if (this.head !== null) return;
        if (this.tail.length === 0) {
            this.checkStopped();
            return;
        }
        this.draining = true;
        try {
            while (this.tail.length > 0) {
                if (this.abandoned) break;
                const entry = this.tail.shift()!;
                if (entry.settled || this.cancelInFlight.has(entry.requestId)) {
                    this.cancelInFlight.delete(entry.requestId);
                    this.safeBroadcast("queueStateChanged", () =>
                        this.broadcast.queueStateChanged(this.getSnapshot()),
                    );
                    continue;
                }
                this.head = entry;
                entry.state = "running";
                entry.startedAt = Date.now();
                const startVersion = ++this.snapshotVersion;
                this.safeBroadcast("requestStarted", () =>
                    this.broadcast.requestStarted(
                        this.publicCopy(entry),
                        startVersion,
                    ),
                );
                this.safeBroadcast("queueStateChanged", () =>
                    this.broadcast.queueStateChanged(this.getSnapshot()),
                );
                this.log("requestQueue:start", {
                    requestId: entry.requestId,
                    connectionId: entry.originatorConnectionId,
                    waitMs: entry.startedAt - entry.submittedAt,
                });

                let result: CommandResult | undefined;
                let error: unknown = undefined;
                try {
                    const ctx: QueueExecutionContext = {
                        requestId: entry.requestId,
                        originatorConnectionId: entry.originatorConnectionId,
                        text: entry.text,
                    };
                    if (entry.clientRequestId !== undefined)
                        ctx.clientRequestId = entry.clientRequestId;
                    if (entry.attachments !== undefined)
                        ctx.attachments = entry.attachments;
                    if (entry.options !== undefined)
                        ctx.options = entry.options;
                    result = await this.innerProcessCommand(ctx);
                    if (result?.cancelled) {
                        entry.state = "cancelled";
                        if (entry.error === undefined) {
                            entry.error = `cancelled:${entry.cancelReason ?? "user"}`;
                        }
                    } else {
                        entry.state = "succeeded";
                    }
                } catch (e) {
                    error = e;
                    const isAbort =
                        e instanceof Error && e.name === "AbortError";
                    if (entry.cancelReason !== undefined && isAbort) {
                        entry.state = "cancelled";
                        if (entry.error === undefined) {
                            entry.error = `cancelled:${entry.cancelReason}`;
                        }
                        error = undefined;
                        result = { cancelled: true };
                    } else {
                        entry.state = "failed";
                        entry.error =
                            e instanceof Error ? e.message : String(e);
                    }
                }
                entry.finishedAt = Date.now();
                if (entry.settled) {
                    this.head = null;
                    continue;
                }
                entry.settled = true;
                this.head = null;
                ++this.snapshotVersion;

                this.log("requestQueue:complete", {
                    requestId: entry.requestId,
                    connectionId: entry.originatorConnectionId,
                    state: entry.state,
                    runMs: (entry.finishedAt ?? 0) - (entry.startedAt ?? 0),
                    totalMs: (entry.finishedAt ?? 0) - entry.submittedAt,
                });
                this.safeBroadcast("queueStateChanged", () =>
                    this.broadcast.queueStateChanged(this.getSnapshot()),
                );
                if (error !== undefined) {
                    entry.rejectCompletion(error);
                } else {
                    entry.resolveCompletion(result);
                }
            }
        } finally {
            this.draining = false;
            this.checkStopped();
        }
    }

    private checkStopped(): void {
        if (this.stopped && this.head === null && this.tail.length === 0) {
            const resolvers = this.stoppedResolvers;
            this.stoppedResolvers = [];
            for (const r of resolvers) {
                try {
                    r();
                } catch {
                    // best-effort
                }
            }
        }
    }
}

/** Public helper to await an entry's completion without exposing internal fields. */
export function entryCompletion(
    entry: ReturnType<RequestQueue["submit"]>,
): Promise<CommandResult | undefined> {
    return entry.completion;
}

/** Re-export for consumers that build CancelResult without going via the queue. */
export type { CancelResult };
