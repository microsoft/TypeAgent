// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ProcessCommandOptions } from "./dispatcher.js";

/**
 * Lifecycle states of a queued request.
 *
 * - `queued` — accepted by the server, waiting for the drain loop.
 * - `running` — currently executing on the inner dispatcher.
 * - `awaiting_interaction` — running but blocked waiting for a
 *   client to respond to a `question` / `proposeAction` (sub-state
 *   of running; the head does not advance past it).
 * - `succeeded` / `failed` / `cancelled` — terminal.
 */
export type QueueRequestState =
    | "queued"
    | "running"
    | "awaiting_interaction"
    | "succeeded"
    | "failed"
    | "cancelled";

/**
 * Reason carried with `requestCancelled` events.
 */
export type QueueCancelReason = "user" | "timeout" | "disconnect";

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

    /** Attachments forwarded to the inner dispatcher. */
    attachments?: string[];

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

    /** Optional `lastActionSchemaName` captured at submit time. */
    schemaHint?: string;

    /** Optional activity-context name captured at submit time. */
    activityHint?: string;

    /** Set when the entry transitions to `failed` or `cancelled`. */
    error?: string;
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
}
