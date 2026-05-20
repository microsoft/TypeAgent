// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import type {
    CommandResult,
    Dispatcher,
    ProcessCommandOptions,
    QueueCancelReason,
    QueuedRequest,
    QueueSnapshot,
} from "@typeagent/dispatcher-types";

import registerDebug from "debug";
const debug = registerDebug("agent-server:messageQueue");

/**
 * Push channel used by the queue to broadcast lifecycle events to
 * every connected client. SharedDispatcher wires this to its own
 * `broadcast()` helper so push events fan out to all clients
 * regardless of which one submitted the entry.
 */
export interface QueueBroadcaster {
    requestQueued(entry: QueuedRequest): void;
    requestStarted(entry: QueuedRequest): void;
    requestCancelled(requestId: string, reason: QueueCancelReason): void;
    queueStateChanged(snapshot: QueueSnapshot): void;
}

/** Optional telemetry sink. */
export interface QueueLogger {
    logEvent(name: string, data: unknown): void;
}

/**
 * Resolve the inner dispatcher to use for executing a queued entry.
 * SharedDispatcher provides the originator's per-connection dispatcher
 * when it is still connected (so display log + commandComplete fan-out
 * are correctly attributed); when the originator has disconnected the
 * implementation should fall back to any remaining dispatcher so the
 * side effects still run — see design §"Drain when all clients
 * disconnect: YES — keep draining".
 */
export type DispatcherResolver = (entry: QueuedRequest) => Dispatcher;

/**
 * Concrete inputs accepted by `MessageQueue.submit`. Mirrors the
 * arguments of `Dispatcher.submitCommand` plus the originating
 * connection id (which only the server knows).
 */
export interface QueueSubmitInput {
    text: string;
    originatorConnectionId: string;
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
}

/**
 * Server-side per-conversation message queue. Replaces implicit
 * serialization-via-`commandLock` with an explicit, observable FIFO
 * pipeline. See `docs/architecture` and the design doc
 * `messageQueueing-serverSide.md` for the broader picture.
 *
 * Phase 1 scope:
 *   - submit / cancel-queued / cancel-running
 *   - FIFO drain (one in-flight at a time)
 *   - lifecycle push events + snapshot
 *
 * Out of scope (Phase 2):
 *   - reorder / edit / pause / resume / interrupt
 */
export class MessageQueue {
    private readonly tail: InternalEntry[] = [];
    private head: InternalEntry | null = null;
    private draining = false;
    private stopped = false;
    private stoppedResolvers: Array<() => void> = [];

    constructor(
        private readonly resolveDispatcher: DispatcherResolver,
        private readonly broadcast: QueueBroadcaster,
        private readonly logger?: QueueLogger,
    ) {}

    // ---------- public API ----------

    /**
     * Append a new entry, broadcast `requestQueued` +
     * `queueStateChanged`, and start the drain loop if idle. Returns
     * an InternalEntry whose `completion` promise resolves when the
     * entry reaches a terminal state.
     */
    submit(input: QueueSubmitInput): InternalEntry {
        if (this.stopped) {
            throw new Error("MessageQueue has been stopped");
        }
        const entry = this.materialize(input);
        this.tail.push(entry);
        this.broadcast.requestQueued(this.publicCopy(entry));
        this.broadcast.queueStateChanged(this.getSnapshot());
        this.log("messageQueue:submit", {
            requestId: entry.requestId,
            connectionId: entry.originatorConnectionId,
            queuedAhead: this.tail.length - 1,
            running: this.head !== null,
        });
        // Fire-and-forget; errors are surfaced through completion promises.
        void this.maybeDrain();
        return entry;
    }

    /**
     * Remove a queued (not running) entry. Returns true if removed.
     * Cancelling the currently-running entry goes through the
     * existing `Dispatcher.cancelCommand` path; this method is
     * deliberately scoped to queued entries.
     */
    cancelQueued(requestId: string, reason: QueueCancelReason): boolean {
        const idx = this.tail.findIndex((e) => e.requestId === requestId);
        if (idx < 0) {
            return false;
        }
        const [entry] = this.tail.splice(idx, 1);
        entry.state = "cancelled";
        entry.finishedAt = Date.now();
        entry.error = `cancelled:${reason}`;
        try {
            this.broadcast.requestCancelled(entry.requestId, reason);
            this.broadcast.queueStateChanged(this.getSnapshot());
        } finally {
            entry.settled = true;
            entry.resolveCompletion({ cancelled: true });
        }
        this.log("messageQueue:cancel", {
            requestId: entry.requestId,
            connectionId: entry.originatorConnectionId,
            reason,
            waitMs: entry.finishedAt - entry.submittedAt,
            phase: "queued",
        });
        return true;
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
        };
    }

    /**
     * Notify the queue that a client disconnected. Phase 1 does NOT
     * drain or cancel based on originator disconnect — side effects
     * matter, the user may reconnect from another client. This hook
     * exists so Phase 2 / observability code can react.
     */
    onClientDisconnect(_connectionId: string): void {
        // Intentionally empty in Phase 1 — see design §"Drain when
        // all clients disconnect: YES — keep draining".
    }

    /**
     * Wait until any in-flight + queued entries finish. New submit
     * calls after this is invoked throw. Used during conversation
     * shutdown.
     */
    async drainAndStop(): Promise<void> {
        this.stopped = true;
        if (this.head === null && this.tail.length === 0) {
            return;
        }
        return new Promise<void>((resolve) => {
            this.stoppedResolvers.push(resolve);
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
            completion,
            resolveCompletion,
            rejectCompletion,
            settled: false,
        };
        if (input.clientRequestId !== undefined) {
            entry.clientRequestId = input.clientRequestId;
        }
        if (input.attachments !== undefined) {
            entry.attachments = input.attachments;
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
     * Strip the internal-only fields before broadcasting / snapshotting.
     */
    private publicCopy(entry: InternalEntry): QueuedRequest {
        const {
            completion: _c,
            resolveCompletion: _r,
            rejectCompletion: _j,
            settled: _s,
            ...pub
        } = entry;
        return { ...pub };
    }

    private log(name: string, data: unknown): void {
        try {
            debug(name, data);
            this.logger?.logEvent(name, data);
        } catch {
            // best-effort telemetry
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
                const entry = this.tail.shift()!;
                if (entry.settled) {
                    // Cancelled while being dequeued — skip.
                    continue;
                }
                this.head = entry;
                entry.state = "running";
                entry.startedAt = Date.now();
                this.broadcast.requestStarted(this.publicCopy(entry));
                this.broadcast.queueStateChanged(this.getSnapshot());
                this.log("messageQueue:start", {
                    requestId: entry.requestId,
                    connectionId: entry.originatorConnectionId,
                    waitMs: entry.startedAt - entry.submittedAt,
                });

                let result: CommandResult | undefined;
                let error: unknown = undefined;
                try {
                    const dispatcher = this.resolveDispatcher(
                        this.publicCopy(entry),
                    );
                    result = await dispatcher.processCommand(
                        entry.text,
                        entry.clientRequestId,
                        entry.attachments,
                        entry.options,
                        entry.requestId,
                    );
                    if (result?.cancelled) {
                        entry.state = "cancelled";
                    } else {
                        entry.state = "succeeded";
                    }
                } catch (e) {
                    error = e;
                    entry.state = "failed";
                    entry.error = e instanceof Error ? e.message : String(e);
                }
                entry.finishedAt = Date.now();
                entry.settled = true;
                this.head = null;

                this.log("messageQueue:complete", {
                    requestId: entry.requestId,
                    connectionId: entry.originatorConnectionId,
                    state: entry.state,
                    runMs: (entry.finishedAt ?? 0) - (entry.startedAt ?? 0),
                    totalMs: (entry.finishedAt ?? 0) - entry.submittedAt,
                });
                try {
                    this.broadcast.queueStateChanged(this.getSnapshot());
                } catch {
                    // best-effort
                }
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
    entry: ReturnType<MessageQueue["submit"]>,
): Promise<CommandResult | undefined> {
    return entry.completion;
}
