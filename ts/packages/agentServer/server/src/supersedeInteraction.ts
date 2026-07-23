// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PendingInteractionManager } from "agent-dispatcher/internal";
import type { QueuedRequest } from "@typeagent/dispatcher-types";

/**
 * Dependencies for {@link supersedeStalledInteraction}, injected so the policy
 * can be unit-tested against a real {@link PendingInteractionManager} without a
 * full SharedDispatcher / agent-execution stack.
 */
export interface SupersedeStalledInteractionDeps {
    /** The current running queue head (`getSnapshot().running`), or null when idle. */
    runningEntry: Pick<QueuedRequest, "requestId" | "blockedOn"> | null;
    /** Owns the deferred promises for in-flight `question` / `proposeAction` / `form` interactions. */
    pendingInteractions: Pick<
        PendingInteractionManager,
        "getPending" | "cancel"
    >;
    /** Fire the request's AbortController (unwinds the reasoning loop / agent). */
    abortRequest(requestId: string): void;
    /** Mark the running request cancelled in the queue (records the cancel reason). */
    cancelRunning(requestId: string): void;
    /** Notify clients + DisplayLog that an interaction was cancelled (drops the stale card). */
    onInteractionCancelled(interactionId: string): void;
    debug?(message: string): void;
}

/**
 * Unwind a running request that is stalled waiting on a client interaction
 * (`blockedOn: "interaction"`, e.g. the reasoning loop's `ask_user` /
 * `ask_user_form` blocked for an answer). Such a head holds the command lock
 * and keeps the reasoning session from going idle, so nothing else in the queue
 * can run until the interaction / reasoning-loop timeout (up to ~20 min).
 *
 * Rejects the head's pending interaction(s) with an `AbortError` (which
 * `command.ts` classifies as `cancelled`), tells clients to drop the now-stale
 * prompt card, then cancels + aborts the request so it unwinds immediately.
 *
 * Returns true when a blocked running request was superseded, false when the
 * head is idle or actively making progress (left alone; the caller enqueues the
 * new request behind it as usual).
 */
export function supersedeStalledInteraction(
    deps: SupersedeStalledInteractionDeps,
    message: string,
): boolean {
    const head = deps.runningEntry;
    if (head === null || head.blockedOn !== "interaction") {
        return false;
    }
    const rid = head.requestId;
    const abortErr = new Error(message);
    abortErr.name = "AbortError";
    try {
        for (const pend of deps.pendingInteractions
            .getPending()
            .filter((r) => r.requestId?.requestId === rid)) {
            if (deps.pendingInteractions.cancel(pend.interactionId, abortErr)) {
                deps.onInteractionCancelled(pend.interactionId);
            }
        }
    } catch (e) {
        deps.debug?.(
            `supersedeStalledInteraction: failed to cancel pending interactions: ${e}`,
        );
    }
    deps.cancelRunning(rid);
    deps.abortRequest(rid);
    return true;
}
