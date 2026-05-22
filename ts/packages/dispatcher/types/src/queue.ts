// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Phase 1 server-side message queue contract.  See
// `docs/architecture/messageQueueing-serverSide.md` for the full design.
//
// The queue is per-conversation and FIFO with a single in-flight entry. Any
// connected client may submit, cancel, or list entries. Phase 2 may layer
// per-client privacy or ACLs on top — see TODO notes below.

import type { ProcessCommandOptions } from "./dispatcher.js";

/**
 * Lifecycle states of a queued request.
 *
 * - `queued` — accepted by the server, waiting for the drain loop.
 * - `running` — currently executing on the inner dispatcher. A
 *   running entry that is waiting for a client to respond to a
 *   `question` / `proposeAction` carries an additional
 *   `blockedOn: "interaction"` field on `QueuedRequest`; the state
 *   stays `running` and the head does not advance past it.
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
 * - `user` — explicit user cancel (most common).
 * - `timeout` — server-imposed timeout (reserved for Phase 2).
 * - `disconnect` — originator's connection went away (reserved).
 * - `server_stopping` — bounded shutdown deadline elapsed and the
 *   server abandoned the entry. Clients should render a distinct
 *   message ("server is shutting down") instead of the generic
 *   "cancelled". See `ServerStoppingError` and `drainAndStop`.
 * - `queue_full` — reserved for symmetry; Phase 1 doesn't broadcast
 *   this (the submit RPC reports `error: "queue_full"` instead).
 * - `no_clients` — last connected client disconnected and the 30s
 *   grace timer elapsed without any reconnect. The queue is being
 *   cleared (queued + any running-blocked-on-interaction entries).
 *   See messageQueueing.md §11.4.
 */
export type QueueCancelReason =
    | "user"
    | "timeout"
    | "disconnect"
    | "server_stopping"
    | "queue_full"
    | "no_clients";

/**
 * Wire-level shape for a single queued request. The server holds
 * exactly one of these per submission and broadcasts a fresh copy
 * with every transition.
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
     * Attachments forwarded to the inner dispatcher.
     *
     * NOTE: For Phase 1, attachments are STRIPPED from broadcast events
     * and snapshots before they leave the server (see
     * `attachmentCount` for the wire-safe summary). Only the originator
     * — which holds the real bytes locally — needs the data; other
     * clients should never receive raw attachments via the queue
     * channel because they may be large (base64 images) and are
     * private. The field remains in this type for API completeness on
     * the *submit* side; the server replaces it with `undefined` on
     * the *broadcast* side. TODO(Phase 2): surface a per-client
     * privacy policy here.
     */
    attachments?: string[];

    /**
     * Number of attachments associated with this request. Always present
     * on broadcast / snapshot copies (zero when there are none); used by
     * `/queue list` and shell badge tooltips so other clients see "[N
     * attachments]" without receiving the raw bytes.
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
     * Sub-state while `state === "running"`. Set when the inner
     * dispatcher is awaiting a `clientIO.question` /
     * `proposeAction` response; the drain loop does NOT advance past
     * a `running` entry regardless of `blockedOn`. Absent at all
     * other times.
     */
    blockedOn?: "interaction";

    /**
     * Execution attempt for retry. `1` for the first run; an
     * incremented value if the entry was retried (server-internal —
     * Phase 1 does not retry automatically, but the field is on the
     * wire so future retry policies don't require a protocol bump).
     * `requestId` is stable across retries; `attempt` is the
     * per-attempt identity.
     */
    attempt: number;

    /** Optional `lastActionSchemaName` captured at submit time. */
    schemaHint?: string;

    /** Optional activity-context name captured at submit time. */
    activityHint?: string;

    /** Set when the entry transitions to `failed` or `cancelled`. */
    error?: string;

    /**
     * Edit history — append-only audit trail of `editQueued`
     * mutations. Each entry records the wall-clock time, the
     * `connectionId` that performed the edit, and the previous text.
     * Populated by `editQueued` in Phase 2; absent in Phase 1.
     */
    edits?: Array<{ at: number; by: string; oldText: string }>;
}

/**
 * Snapshot of the queue's current state. Used by `getQueueSnapshot`
 * and by `queueStateChanged` push events. Always reflects the state
 * AFTER the triggering transition.
 */
export interface QueueSnapshot {
    /** The currently-running entry, or null when the queue is idle. */
    running: QueuedRequest | null;

    /** Pending entries in FIFO order. */
    queued: QueuedRequest[];

    /** True if the drain loop is paused. Always `false` in Phase 1. */
    paused: boolean;

    /**
     * Why the queue is paused. Absent when `paused === false`.
     * Phase 1 never sets this (Phase 1 cancels queued entries on
     * the all-clients-disconnect grace expiry rather than pausing —
     * see messageQueueing.md §11.4). Reserved for Phase 2.
     */
    pauseReason?: "user" | "no-clients";

    /**
     * Monotonically increasing version stamp. Incremented by the
     * server on every queue mutation (submit, start, cancel, complete)
     * and copied onto every push-event payload that carries a snapshot
     * or single-entry view. Clients track the highest version they've
     * applied and discard events with `version <= lastAppliedVersion`
     * to ignore reorderings caused by RPC delivery races.
     *
     * Note: starts at `0` for an idle, never-mutated queue. Bootstrap
     * snapshot apply MUST set `lastAppliedVersion = snapshot.version`
     * (without the usual `<=` check) so the very first event after
     * bootstrap isn't suppressed.
     */
    version: number;
}

/**
 * Per-event payload carrying the queue version at emit time. The CLI
 * and Shell renderer use it to ignore stale events delivered out of
 * order — see `QueueSnapshot.version`.
 */
export interface QueueEventVersion {
    version: number;
}

/**
 * Outcome of `Dispatcher.cancelCommand`. The four kinds capture what
 * the server actually did so the caller can render an honest message
 * instead of a generic "cancel requested".
 *
 * - `cancelled_queued` — the entry was waiting in the tail; it was
 *   spliced out and its completion promise resolved with
 *   `{ cancelled: true }`. No work ran.
 * - `cancelled_running` — the entry was the head; its AbortController
 *   was triggered. The associated `processCommand` will resolve with
 *   `{ cancelled: true }` once the cancellation checkpoint fires.
 * - `not_found` — no queued or running entry has this `requestId`. The
 *   id may be stale, already-completed (Phase 1 does not track
 *   completion history), or simply unknown.
 * - `already_completed` — reserved for Phase 2 when the queue gains a
 *   short-lived completion-history cache. Phase 1 always reports
 *   `not_found` instead; clients should treat the two equivalently.
 */
export type CancelResult =
    | { kind: "cancelled_queued"; requestId: string }
    | { kind: "cancelled_running"; requestId: string }
    | { kind: "not_found"; requestId: string }
    | { kind: "already_completed"; requestId: string };

/**
 * Thrown by `RequestQueue.submit` (and surfaced through
 * `Dispatcher.submitCommand` / `processCommand`) when the per-
 * conversation queue is at its hard cap. The cap exists as a coarse
 * DOS guard — see `MAX_QUEUE_DEPTH` in requestQueue.ts. Clients
 * should distinguish this from a generic dispatcher error and offer a
 * "try again later" message.
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
 * Thrown internally by `RequestQueue.submit` after `drainAndStop` has
 * been invoked, and carried through `SubmitResult`'s `server_stopping`
 * variant on the wire. Server-side only — RPC strips the class
 * identity, so cross-process consumers MUST branch on
 * `SubmitResult.error === "server_stopping"` instead of `instanceof`.
 * See `RequestQueue.drainAndStop`.
 */
export class ServerStoppingError extends Error {
    public readonly code = "SERVER_STOPPING" as const;
    constructor(message?: string) {
        super(message ?? "Server is shutting down");
        this.name = "ServerStoppingError";
    }
}

/**
 * Discriminated result type returned by `Dispatcher.submitCommand`.
 *
 * Phase 1's first iteration threw `QueueFullError` from `submitCommand`
 * to signal a full queue, but the dispatcher RPC layer flattens errors
 * to plain `Error` instances on the wire — `instanceof QueueFullError`
 * never holds on the client side, and the structured `code`/`maxDepth`
 * fields are dropped. Returning a discriminated value is the only way
 * to give cross-process clients a typed "queue full" / "server
 * stopping" signal without inventing an out-of-band error wrapper.
 *
 * The internal `RequestQueue.submit` still throws `QueueFullError` /
 * `ServerStoppingError` for the convenience of in-process callers;
 * `SharedDispatcher.submitCommand` catches both and maps them to the
 * `error` variants below before they cross the RPC boundary.
 */
export type SubmitResult =
    | { ok: true; entry: QueuedRequest }
    | { ok: false; error: "queue_full"; maxDepth: number }
    | { ok: false; error: "server_stopping" };
