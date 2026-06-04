// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Server-side message queue contract. Per-conversation, FIFO, single in-flight
// entry. See `docs/architecture/messageQueueing-serverSide.md` for the design.

import type { CommandResult, ProcessCommandOptions } from "./dispatcher.js";

/**
 * Lifecycle states of a queued request.
 *
 * - `queued` — waiting for the drain loop.
 * - `running` — executing on the inner dispatcher (may carry `blockedOn: "interaction"`).
 * - `succeeded` / `failed` / `cancelled` — terminal.
 */
export type QueueRequestState =
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled";

/**
 * Reason carried with `requestCancelled` events.
 *
 * - `user` — explicit user cancel.
 * - `timeout` / `disconnect` / `queue_full` — reserved for future use.
 * - `server_stopping` — shutdown deadline elapsed and the server abandoned the entry.
 * - `no_clients` — all clients disconnected past the grace window.
 */
export type QueueCancelReason =
    | "user"
    | "timeout"
    | "disconnect"
    | "server_stopping"
    | "queue_full"
    | "no_clients";

/**
 * Wire-level shape for a single queued request. The server broadcasts a fresh
 * copy with every transition.
 */
export interface QueuedRequest {
    /** Server-assigned UUID — same value used for `RequestId.requestId`. */
    requestId: string;

    /** Client-supplied opaque id passed back for round-trip mapping. */
    clientRequestId?: unknown;

    /** The connection that submitted this entry. May disconnect later. */
    originatorConnectionId: string;

    /** Raw user input. */
    text: string;

    /**
     * Attachments forwarded to the inner dispatcher. Stripped from broadcasts
     * and snapshots — peers see only `attachmentCount`. Present only on the
     * submit side.
     */
    attachments?: string[];

    /**
     * Number of attachments on this request. Always present on broadcast /
     * snapshot copies so peers can render "[N attachments]" without the bytes.
     */
    attachmentCount?: number;

    /** Options forwarded to the inner dispatcher. */
    options?: ProcessCommandOptions;

    /** Wall-clock (ms since epoch) when the entry joined the queue. */
    submittedAt: number;

    /** Wall-clock (ms since epoch) when the drain loop popped the entry. */
    startedAt?: number;

    /** Wall-clock (ms since epoch) when the entry reached a terminal state. */
    finishedAt?: number;

    /** Lifecycle state. */
    state: QueueRequestState;

    /**
     * Sub-state while `state === "running"`. Set when the inner dispatcher is
     * awaiting a `clientIO.question` / `proposeAction` response. The drain
     * loop does NOT advance past a `running` entry regardless of `blockedOn`.
     */
    blockedOn?: "interaction";

    /** Set when the entry transitions to `failed` or `cancelled`. */
    error?: string;
}

/**
 * Snapshot of the queue's current state. Reflects the state AFTER the
 * triggering transition.
 */
export interface QueueSnapshot {
    /** The currently-running entry, or null when the queue is idle. */
    running: QueuedRequest | null;

    /** Pending entries in FIFO order. */
    queued: QueuedRequest[];

    /** True if the drain loop is paused. */
    paused: boolean;

    /** Why the queue is paused. Absent when `paused === false`. */
    pauseReason?: "user" | "no-clients";

    /**
     * Monotonically increasing version stamp, incremented on every queue
     * mutation. Clients track the highest version applied and discard events
     * with `version <= lastAppliedVersion` to ignore RPC delivery reorderings.
     *
     * Starts at `0`. Bootstrap apply MUST set `lastAppliedVersion =
     * snapshot.version` (no `<=` check) so the first event isn't suppressed.
     */
    version: number;
}

/** Per-event payload carrying the queue version at emit time. */
export interface QueueEventVersion {
    version: number;
}

/**
 * Outcome of `Dispatcher.cancelCommand`.
 *
 * - `cancelled_queued` — entry was spliced from the tail; no work ran.
 * - `cancelled_running` — entry was the head; AbortController triggered.
 * - `not_found` — unknown `requestId` (or already completed).
 * - `already_completed` — reserved for future use; treat equivalently to `not_found`.
 */
export type CancelResult =
    | { kind: "cancelled_queued"; requestId: string }
    | { kind: "cancelled_running"; requestId: string }
    | { kind: "not_found"; requestId: string }
    | { kind: "already_completed"; requestId: string };

/**
 * Thrown by `RequestQueue.submit` when the per-conversation queue is at its
 * hard cap (a coarse DOS guard). Clients should surface a "try again later".
 */
export class QueueFullError extends Error {
    public readonly code = "QUEUE_FULL" as const;
    public readonly maxDepth: number;
    constructor(maxDepth: number) {
        super(
            `Queue is full (${maxDepth} requests). Try again after some complete.`,
        );
        this.name = "QueueFullError";
        this.maxDepth = maxDepth;
    }
}

/**
 * Thrown internally by `RequestQueue.submit` after `drainAndStop`. Server-side
 * only — RPC strips class identity, so cross-process consumers MUST branch on
 * `SubmitResult.error === "server_stopping"` instead of `instanceof`.
 */
export class ServerStoppingError extends Error {
    public readonly code = "SERVER_STOPPING" as const;
    constructor(message?: string) {
        super(message ?? "Server is shutting down");
        this.name = "ServerStoppingError";
    }
}

/**
 * The queue entry handed back to the submitter. Extends the broadcast
 * `QueuedRequest` shape with a `completion` promise — the submitter owns
 * the completion handle, peers viewing the queue via snapshots/broadcasts
 * only ever see the broadcast `QueuedRequest` (no promise crosses to peer
 * clients).
 *
 * `completion` resolves with the eventual `CommandResult` (or
 * `{cancelled: true}` for cancelled requests, or rejects with
 * `ServerStoppingError` if the server abandoned the entry).
 *
 * For in-process dispatchers `completion` is the queue's internal entry
 * promise directly. For RPC clients it is synthesized by the client
 * wrapper from `commandComplete` and `requestCancelled` ClientIO push
 * events — see `WireSubmitResult` for the RPC-layer transport type.
 */
export interface SubmittedRequest extends QueuedRequest {
    completion: Promise<CommandResult | undefined>;
}

/**
 * Discriminated result returned by `Dispatcher.submitCommand`.
 *
 * Failure modes are data (not thrown) because the RPC layer flattens errors
 * to plain `Error` on the wire, dropping subclass identity and structured
 * fields.
 *
 * On success the result carries a `SubmittedRequest` — the queue ack with
 * a `completion` promise attached. Callers who only need ack-on-enqueue
 * semantics can ignore `entry.completion`; callers that previously used
 * `processCommand` await `entry.completion` after the `ok:true` check.
 */
export type SubmitResult =
    | { ok: true; entry: SubmittedRequest }
    | { ok: false; error: "queue_full"; maxDepth: number }
    | { ok: false; error: "server_stopping" };
