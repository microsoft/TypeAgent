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
// `typeagent:requestQueue` is the canonical namespace for queue lifecycle
// telemetry — see the design doc. Enable with `DEBUG=typeagent:requestQueue`.
const debug = registerDebug("typeagent:requestQueue");
const debugInternal = registerDebug("agent-server:requestQueue");

/**
 * Hard cap on the number of entries (running + queued) the per-
 * conversation queue will hold before refusing new submits with
 * `QueueFullError`. This is a coarse DOS guard — Phase 1 deliberately
 * does NOT do per-client rate limiting; a malicious or runaway client
 * within a conversation can fill the queue but cannot exceed this
 * bound. Tunable for tests by importing this constant.
 */
export const MAX_QUEUE_DEPTH = 100;

/**
 * Default deadline (ms) given to `drainAndStop` before in-flight and
 * queued entries are forcibly abandoned. Exposed as a constant so
 * higher layers (server lifecycle / tests) can override and so the
 * value isn't hidden behind a magic number. Production servers
 * should not raise this past ~60s — the intent is graceful drain,
 * not unbounded shutdown.
 */
export const SHUTDOWN_DRAIN_DEADLINE_MS = 30_000;

/**
 * Push channel used by the queue to broadcast lifecycle events to
 * every connected client. SharedDispatcher wires this to its own
 * `broadcast()` helper so push events fan out to all clients
 * regardless of which one submitted the entry.
 *
 * Each event also carries the queue's monotonically increasing
 * `version` (the same value present on `QueueSnapshot.version`) so
 * clients can suppress stale events delivered out of order. Adding a
 * version parameter rather than a wrapper object keeps the broadcast
 * surface flat for SharedDispatcher's per-event RPC fan-out.
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

/**
 * SECURITY MODEL
 *
 * The queue trusts every client connected to the host's
 * SharedDispatcher: any connected client may submit, cancel (queued),
 * cancel (running), and observe any entry — including entries
 * submitted by other clients. This is intentional for Phase 1 (the
 * design doc treats sharing-a-conversation == sharing-the-queue) but
 * means socket reachability is the only access boundary. R2P-M-1
 * tracks the addition of a real auth boundary — out of scope here.
 */

/** Optional telemetry sink. */
export interface QueueLogger {
    logEvent(name: string, data: unknown): void;
}

/**
 * Inner-dispatcher invocation surface used by the drain loop. The
 * RequestQueue receives a function reference at construction time
 * rather than a full Dispatcher; this guarantees the queue can never
 * accidentally re-enter the public `processCommand` wrapper that
 * would re-queue (the historical bug fixed in Round 1).
 *
 * Note: this callback receives the *raw* attachments (not the wire-
 * redacted form) so the originator's processing pipeline can use the
 * attachment bytes. Broadcasting redaction happens elsewhere.
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

/**
 * Concrete inputs accepted by `RequestQueue.submit`. Mirrors the
 * arguments of `Dispatcher.submitCommand` plus the originating
 * connection id (which only the server knows).
 */
export interface QueueSubmitInput {
    text: string;
    originatorConnectionId: string;
    /**
     * Real attachments. Stored on the InternalEntry so the drain loop
     * can forward them to the inner dispatcher; STRIPPED from any
     * copy that crosses the broadcast channel — see `publicCopy`.
     */
    attachments?: string[];
    options?: ProcessCommandOptions;
    clientRequestId?: unknown;
    schemaHint?: string;
    activityHint?: string;
}

/**
 * Internal extension of `QueuedRequest` that carries the completion
 * promise plumbing. The promise is resolved by the drain loop when
 * the entry finishes (success, failure, or cancellation), giving
 * callers — notably the legacy `processCommand` wrapper — a way to
 * await completion without subscribing to events.
 */
interface InternalEntry extends QueuedRequest {
    completion: Promise<CommandResult | undefined>;
    resolveCompletion: (result: CommandResult | undefined) => void;
    rejectCompletion: (err: unknown) => void;
    settled: boolean;
    /**
     * Reference count for concurrent `blockedOn: "interaction"`
     * holds. An agent may issue overlapping `clientIO.question` /
     * `proposeAction` calls (e.g. `await Promise.all([...])`); each
     * acquires its own mark/unmark pair via
     * {@link RequestQueue.markBlocked} / {@link RequestQueue.markUnblocked}.
     * The wire-visible `blockedOn` field is derived from
     * `blockedOnDepth > 0` in {@link RequestQueue.publicCopy} so a
     * surviving interaction keeps the running entry visibly blocked
     * even after its sibling resolves. Defaults to `0`; never
     * serialized.
     */
    blockedOnDepth: number;
    /**
     * Reason captured by {@link RequestQueue.cancelRunning} when an
     * external cancel was requested for the head entry. The drain
     * loop preserves it on completion so the final wire `error`
     * field reads `cancelled:<reason>` consistently across the
     * queued-cancel and running-cancel paths. Absent until the
     * cancel hook fires; never serialized.
     */
    cancelReason?: QueueCancelReason;
}

/**
 * Server-side per-conversation request queue. Replaces implicit
 * serialization-via-`commandLock` with an explicit, observable FIFO
 * pipeline. See the `messageQueueing.md` design doc for the broader
 * picture.
 *
 * Phase 1 scope:
 *   - submit / cancel-queued / cancel-running
 *   - FIFO drain (one in-flight at a time)
 *   - lifecycle push events + snapshot
 *   - hard cap (`MAX_QUEUE_DEPTH`)
 *
 * Out of scope (Phase 2):
 *   - edit / pause / resume
 *   - per-client ACL (any connected client may cancel any entry — by
 *     design, since users may submit from one client and cancel from
 *     another)
 */
export class RequestQueue {
    private readonly tail: InternalEntry[] = [];
    private head: InternalEntry | null = null;
    private draining = false;
    private stopped = false;
    private stoppedResolvers: Array<() => void> = [];
    /**
     * Memoized result of the first `drainAndStop` call. All subsequent
     * calls return the same promise so a runaway shutdown loop cannot
     * leak resolvers.
     */
    private drainAndStopPromise: Promise<void> | null = null;
    /** Set when the shutdown deadline elapses; submit() then refuses
     *  with ServerStoppingError. Never reset — once stopped, stopped. */
    private abandoned = false;
    /**
     * Set of requestIds whose cancellation was requested while the
     * entry was still in the tail. The drain loop consults this set
     * after `shift()` so an entry that races past the splice in
     * `cancelQueued` is still skipped deterministically.
     */
    private readonly cancelInFlight = new Set<string>();
    /**
     * Monotonically increasing version stamp. Bumped on every
     * mutation (submit, start, cancel, complete) and copied onto
     * every event payload + snapshot so clients can ignore
     * stale/reordered events.
     */
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
     * Append a new entry, broadcast `requestQueued` +
     * `queueStateChanged`, and start the drain loop if idle. Returns
     * an InternalEntry whose `completion` promise resolves when the
     * entry reaches a terminal state.
     *
     * @throws QueueFullError when the queue is at `MAX_QUEUE_DEPTH`.
     */
    submit(input: QueueSubmitInput): InternalEntry {
        return this.enqueue(input, "tail");
    }

    /**
     * Steering primitive: prepend a new entry at the head of the tail
     * (index 0) so it runs *next*, ahead of any other queued entries.
     * Used by `Dispatcher.interrupt` together with a cancel of the
     * currently-running entry to implement "stop what you're doing
     * and run *this* instead." The caller is responsible for the
     * cancel side of interrupt; this method only owns the prepend.
     *
     * Atomicity: the cancel + prepend pair is safe in either order
     * because new submits always `push` to the tail end, so they can
     * never get ahead of an unshifted interrupt within a single
     * JS event-loop tick.
     *
     * @throws QueueFullError when the queue is at `MAX_QUEUE_DEPTH`.
     */
    interrupt(input: QueueSubmitInput): InternalEntry {
        return this.enqueue(input, "head");
    }

    /**
     * Shared body of {@link submit} and {@link interrupt}. The only
     * difference is whether the new entry lands at the tail end
     * (FIFO submit) or at the head of the tail (interrupt). All
     * other observable behavior — version bump, broadcast order,
     * drain kick-off — is identical.
     */
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
        // Broadcasts are best-effort and isolated; one client throwing
        // must not block other clients or break internal state.
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
        // Fire-and-forget; errors are surfaced through completion promises.
        void this.maybeDrain();
        return entry;
    }

    /**
     * Remove a queued (not running) entry. Returns true if removed.
     * Cancelling the currently-running entry goes through the
     * existing `Dispatcher.cancelCommand` path; this method is
     * deliberately scoped to queued entries.
     *
     * Race semantics: the drain loop's `shift()` and this method's
     * `splice()` cannot be perfectly serialized in JS — `cancelQueued`
     * may run between an entry being shifted and the drain loop
     * checking its cancel state. To make the outcome deterministic we
     * (a) flag the entry's `requestId` in `cancelInFlight` *before*
     * splicing and (b) set `entry.settled = true` *before* broadcasts
     * so a concurrent shifter still sees the cancellation. The drain
     * loop checks both signals after shift and skips execution.
     */
    cancelQueued(requestId: string, reason: QueueCancelReason): boolean {
        const idx = this.tail.findIndex((e) => e.requestId === requestId);
        if (idx < 0) {
            return false;
        }
        // Flag BEFORE splice so a concurrent shifter sees the cancel.
        this.cancelInFlight.add(requestId);
        const [entry] = this.tail.splice(idx, 1);
        // F1 (R2-L-1): once the entry is out of the tail, the drain
        // loop will never see it; the cancelInFlight defense was only
        // needed for the (impossible synchronous) splice/shift race.
        // Eagerly clear the Set entry so it can't accumulate.
        this.cancelInFlight.delete(requestId);
        entry.state = "cancelled";
        entry.finishedAt = Date.now();
        entry.error = `cancelled:${reason}`;
        // Mark settled and resolve the completion BEFORE broadcasts so
        // internal state is consistent regardless of any broadcast
        // exception.
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
     * @internal Used by SharedDispatcher.cancelCommand to classify a
     * cancel: returns `"queued"` if a queued entry was removed,
     * `"running"` if the requestId matches the current head (caller
     * is responsible for the AbortController), `"not_found"`
     * otherwise.
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

    /**
     * Synchronous snapshot suitable for `getQueueSnapshot` RPC and
     * `JoinConversationResult.queueSnapshot`.
     */
    getSnapshot(): QueueSnapshot {
        return {
            running: this.head ? this.publicCopy(this.head) : null,
            queued: this.tail.map((e) => this.publicCopy(e)),
            paused: false, // pause is Phase 2
            version: this.snapshotVersion,
        };
    }

    /**
     * True if the queue has no in-flight or queued entries. Used by
     * `joinConversation` to decide whether to omit the snapshot from
     * `JoinConversationResult` — older / Phase 1 design promises
     * `queueSnapshot` is undefined when idle.
     */
    isIdle(): boolean {
        return this.head === null && this.tail.length === 0;
    }

    /**
     * Notify the queue that a client disconnected. Phase 1 does NOT
     * drain or cancel based on per-connection originator disconnect —
     * side effects matter, the user may reconnect from another
     * client. This hook exists so Phase 2 / observability code can
     * react.
     *
     * For *last-client*-disconnect semantics (the 30-second grace
     * timer), the caller must invoke
     * {@link onAllClientsDisconnected} once the client count drops
     * to zero. The queue does not count clients itself.
     */
    onClientDisconnect(_connectionId: string): void {
        // Intentionally empty in Phase 1 — see design §"Drain when
        // all clients disconnect: YES — keep draining".
    }

    /** Grace-timer state for the last-client-disconnect path. */
    private graceTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Called by SharedDispatcher when the connected-client count
     * drops to zero. Starts a single-shot grace timer; on expiry the
     * queue cancels all queued entries with reason `"no_clients"`
     * and invokes `onExpiry` so the caller can decide what to do
     * with a running entry that is blocked on a clientIO interaction
     * (the design says: cancel it).
     *
     * Idempotent: a second call before reconnect is a no-op (the
     * existing timer keeps ticking). Callers MUST pair every
     * `onAllClientsDisconnected` with `onClientReconnected` when the
     * first new client joins.
     *
     * See messageQueueing.md §11.4.
     */
    onAllClientsDisconnected(
        graceMs: number,
        onExpiry?: (head: QueuedRequest | null) => void,
    ): void {
        if (this.graceTimer !== null) return;
        if (this.stopped) return;
        const fire = () => {
            this.graceTimer = null;
            // Snapshot the queued entries first; cancelQueued mutates
            // `this.tail` in place. Use a copy so iteration is stable.
            const toCancel = this.tail.map((e) => e.requestId);
            for (const rid of toCancel) {
                this.cancelQueued(rid, "no_clients");
            }
            const snap = this.getSnapshot();
            try {
                onExpiry?.(snap.running);
            } catch {
                // best-effort; never let a caller callback corrupt queue state
            }
            this.log("requestQueue:graceExpired", {
                cancelledQueued: toCancel.length,
                runningStillPresent: snap.running !== null,
                runningBlockedOn: snap.running?.blockedOn,
            });
        };
        // Allow the timer to keep Node alive only if there is work
        // pending; tests on idle queues should still be able to exit.
        this.graceTimer = setTimeout(fire, graceMs);
        this.graceTimer.unref?.();
        this.log("requestQueue:graceStarted", { graceMs });
    }

    /**
     * Cancels a pending grace timer. Called by SharedDispatcher when
     * the first client reconnects after a period of total
     * disconnection. Safe to call when no timer is pending (no-op).
     */
    onClientReconnected(): void {
        if (this.graceTimer === null) return;
        clearTimeout(this.graceTimer);
        this.graceTimer = null;
        this.log("requestQueue:graceCleared", {});
    }

    /**
     * @internal Test-only: report whether a grace timer is currently
     * armed. Used by spec tests to verify timer lifecycle without
     * sleeping for the real 30-second window.
     */
    public __testHasGraceTimer(): boolean {
        return this.graceTimer !== null;
    }

    /**
     * Mark the currently-running entry as blocked on a specific
     * external dependency (currently only `"interaction"` —
     * `clientIO.askYesNo` / `proposeAction`). Increments a per-entry
     * reference count; the wire-visible `blockedOn` field stays
     * `"interaction"` as long as the count is positive. When the
     * count transitions `0 → 1`, bumps the snapshot version +
     * broadcasts so connected clients can render an appropriate
     * badge.
     *
     * Called by SharedDispatcher's clientIO wrappers around the
     * `pendingInteractions.create()` await. Must be paired with
     * {@link markUnblocked} when the interaction resolves. Overlapping
     * interactions (e.g. `await Promise.all([question, proposeAction])`)
     * are handled correctly — the second `markBlocked` increments the
     * count without re-broadcasting, and the first matching
     * `markUnblocked` decrements without clearing `blockedOn` on the
     * wire.
     */
    markBlocked(requestId: string, reason: "interaction"): void {
        if (this.head === null || this.head.requestId !== requestId) return;
        void reason;
        this.head.blockedOnDepth += 1;
        if (this.head.blockedOnDepth !== 1) return;
        const version = ++this.snapshotVersion;
        void version;
        this.safeBroadcast("queueStateChanged", () =>
            this.broadcast.queueStateChanged(this.getSnapshot()),
        );
    }

    /**
     * Decrement the blocked reference count on the running entry.
     * Paired with {@link markBlocked}. No-op if the running entry is
     * not the one identified by `requestId` (it may have been
     * cancelled or completed already) or if the count is already
     * zero. Broadcasts a snapshot only on the `1 → 0` transition so
     * concurrent siblings do not produce spurious "blocked cleared"
     * events.
     */
    markUnblocked(requestId: string): void {
        if (this.head === null || this.head.requestId !== requestId) return;
        if (this.head.blockedOnDepth <= 0) return;
        this.head.blockedOnDepth -= 1;
        if (this.head.blockedOnDepth !== 0) return;
        const version = ++this.snapshotVersion;
        void version;
        this.safeBroadcast("queueStateChanged", () =>
            this.broadcast.queueStateChanged(this.getSnapshot()),
        );
    }

    /**
     * Mark the currently-running head as cancelled and broadcast
     * `requestCancelled(reason)` immediately. The entry stays in
     * `head` (state still `"running"`) and the inner dispatcher
     * keeps executing — the caller is responsible for triggering the
     * `AbortController` via `bareDispatcher.cancelCommand(rid)` or
     * equivalent. The drain loop preserves `entry.cancelReason` when
     * the inner command resolves and writes `entry.error =
     * "cancelled:<reason>"` consistently with the queued-cancel path
     * (R2/R3 review fix).
     *
     * **Why no paired `queueStateChanged`** (Round 2 review fix):
     * unlike {@link cancelQueued}, this method does NOT emit a
     * follow-up snapshot. At the moment `cancelRunning` runs, the
     * head's wire-visible `state` is still `"running"` (and stays
     * that way until the drain loop finalizes). Emitting a snapshot
     * here would carry `running.state === "running"` even though the
     * sibling `requestCancelled` event just told clients to remove
     * the entry — under strict-`<` version admission the snapshot
     * would race-resurrect the cancelled entry on the client. The
     * drain loop's completion broadcast (one version higher) is the
     * authoritative snapshot for the cancel transition.
     *
     * Idempotent: returns `false` if the head doesn't match or if a
     * previous `cancelRunning` already recorded a reason.
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
     * Bounded graceful shutdown.
     *
     * Marks the queue as stopped (further `submit` calls throw
     * `ServerStoppingError`) and returns a memoized promise that
     * resolves when the queue empties OR the deadline elapses,
     * whichever happens first. After the deadline fires:
     *   - any in-flight running entry's completion is rejected with
     *     `ServerStoppingError`,
     *   - all queued entries are removed and rejected with the same
     *     error,
     *   - `requestCancelled` is broadcast for every abandoned entry
     *     with reason `"server_stopping"` so clients can render a
     *     distinct shutdown message,
     *   - the returned promise resolves.
     *
     * Subsequent calls return the same promise (no resolver leaks)
     * regardless of `deadlineMs`.
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
            // Ensure a Node test process can exit if the deadline timer
            // is the only thing keeping the loop alive. unref is a
            // no-op if the timer's already fired.
            timer?.unref?.();
        });
        return this.drainAndStopPromise;
    }

    /**
     * Forcibly settle every entry as `server_stopping`. Called from
     * `drainAndStop`'s deadline branch. Idempotent — already-settled
     * entries are skipped.
     */
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
        const requestId = randomUUID();
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
            attempt: 1,
            completion,
            resolveCompletion,
            rejectCompletion,
            settled: false,
            blockedOnDepth: 0,
        };
        if (input.clientRequestId !== undefined) {
            entry.clientRequestId = input.clientRequestId;
        }
        if (input.attachments !== undefined) {
            entry.attachments = input.attachments;
            entry.attachmentCount = input.attachments.length;
        }
        if (input.options !== undefined) {
            entry.options = input.options;
        }
        if (input.schemaHint !== undefined) {
            entry.schemaHint = input.schemaHint;
        }
        if (input.activityHint !== undefined) {
            entry.activityHint = input.activityHint;
        }
        return entry;
    }

    /**
     * Strip the internal-only fields AND the raw attachment payload
     * before broadcasting / snapshotting. The wire copy carries an
     * `attachmentCount` summary so other clients can render "[N
     * attachments]" without seeing the bytes.  See B.1 in the Round 1
     * review notes — text remains visible (queue steering is the
     * point); only attachment payloads are redacted.
     *
     * `blockedOn` is *derived* here from the internal
     * `blockedOnDepth` reference count so concurrent
     * `markBlocked`/`markUnblocked` pairs cannot produce a spurious
     * `blockedOn: undefined` snapshot while a sibling interaction is
     * still pending (R4 review fix).
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
     * Run a broadcaster callback, catching and logging any exception
     * so a single client's failure cannot stall the queue or prevent
     * subsequent broadcasts. Each broadcast call is independently
     * isolated — see F-H-1 in the Round 1 review notes.
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
                // Either flag indicates a cancel that raced the shift —
                // skip without executing. `settled` is the canonical
                // signal; `cancelInFlight` is the belt-and-suspenders
                // backup in case the cancel ran between splice and the
                // settled assignment.
                if (entry.settled || this.cancelInFlight.has(entry.requestId)) {
                    this.cancelInFlight.delete(entry.requestId);
                    // The entry's completion was already resolved in
                    // cancelQueued; just re-broadcast snapshot so any
                    // observer sees the queue advance.
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
                        // Preserve the cancel reason captured by
                        // cancelRunning so the wire `error` field is
                        // populated consistently with cancelQueued
                        // (R2/R3 review fix). If no explicit cancel
                        // ran, fall back to "user" — the inner
                        // controller fired without going through the
                        // queue's cancel hook.
                        if (entry.error === undefined) {
                            entry.error = `cancelled:${entry.cancelReason ?? "user"}`;
                        }
                    } else {
                        entry.state = "succeeded";
                    }
                } catch (e) {
                    error = e;
                    // If the head was marked for cancellation prior
                    // to the throw and the inner error looks like an
                    // abort (e.g. AbortError shaped), classify the
                    // entry as cancelled rather than failed so the
                    // wire state matches the user-visible intent
                    // (R3 review fix).
                    const isAbort =
                        e instanceof Error && e.name === "AbortError";
                    if (entry.cancelReason !== undefined && isAbort) {
                        entry.state = "cancelled";
                        if (entry.error === undefined) {
                            entry.error = `cancelled:${entry.cancelReason}`;
                        }
                        // Drain loop should NOT reject completion for
                        // a cancellation — resolve with the cancelled
                        // result so awaiters see the same shape as
                        // result?.cancelled.
                        error = undefined;
                        result = { cancelled: true };
                    } else {
                        entry.state = "failed";
                        entry.error =
                            e instanceof Error ? e.message : String(e);
                    }
                }
                entry.finishedAt = Date.now();
                // If the deadline fired during inner execution, the
                // abandon path already settled this entry. Skip the
                // duplicate resolve/broadcast.
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

/**
 * Public helper used by SharedDispatcher to wait on the completion
 * of an entry without exposing the internal fields.
 */
export function entryCompletion(
    entry: ReturnType<RequestQueue["submit"]>,
): Promise<CommandResult | undefined> {
    return entry.completion;
}

/** Re-export for consumers that build a CancelResult without going via the queue. */
export type { CancelResult };
