// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unit tests for the `supersedeStalledInteraction` policy: when a new request
 * arrives while the running head is stalled on a client interaction
 * (`blockedOn: "interaction"`, e.g. the reasoning loop's ask_user), the stalled
 * request and its pending interaction must be cancelled so the queue can
 * advance instead of hanging until the interaction / reasoning-loop timeout.
 *
 * Drives the real PendingInteractionManager with fakes for the queue / abort /
 * broadcast side, so it verifies the actual cancellation behavior without a
 * full SharedDispatcher or agent-execution stack (a plain AppAgent can't reach
 * `blockedOn` — that requires a requestId-bound question, which only the
 * dispatcher-internal reasoning / askYesNoWithContext paths issue).
 */

import { describe, expect, test } from "@jest/globals";
import type { PendingInteractionRequest } from "@typeagent/dispatcher-types";
import { PendingInteractionManager } from "agent-dispatcher/internal";
import { supersedeStalledInteraction } from "../src/supersedeInteraction.js";

function questionRequest(
    interactionId: string,
    rid: string,
): PendingInteractionRequest {
    return {
        interactionId,
        type: "question",
        requestId: { requestId: rid },
        source: "reasoning",
        timestamp: Date.now(),
        message: "Which one?",
        choices: ["A", "B"],
    };
}

describe("supersedeStalledInteraction", () => {
    test("cancels the blocked head's interaction, aborts it, and cancels the request", async () => {
        const rid = "req-1";
        const pendingInteractions = new PendingInteractionManager();
        const pending = pendingInteractions.create(questionRequest("i1", rid));
        // A caller that ignores the rejection would surface unhandledRejection;
        // attach an absorbing handler and assert on a mirror below.
        let rejected: Error | undefined;
        pending.catch((e) => {
            rejected = e as Error;
        });

        const cancelledInteractionIds: string[] = [];
        const controller = new AbortController();
        let cancelledRunning: string | undefined;

        const superseded = supersedeStalledInteraction(
            {
                runningEntry: { requestId: rid, blockedOn: "interaction" },
                pendingInteractions,
                abortRequest: (r) => {
                    if (r === rid) controller.abort();
                },
                cancelRunning: (r) => {
                    cancelledRunning = r;
                },
                onInteractionCancelled: (id) =>
                    cancelledInteractionIds.push(id),
            },
            "Superseded by a new request",
        );

        expect(superseded).toBe(true);
        expect(cancelledInteractionIds).toEqual(["i1"]);
        expect(cancelledRunning).toBe(rid);
        expect(controller.signal.aborted).toBe(true);
        expect(pendingInteractions.has("i1")).toBe(false);

        // The deferred question rejects with an AbortError (command.ts maps
        // this to `cancelled`, not `failed`).
        await Promise.resolve();
        expect(rejected?.name).toBe("AbortError");
        expect(rejected?.message).toBe("Superseded by a new request");
    });

    test("no-op when the running head is not blocked on an interaction", () => {
        const pendingInteractions = new PendingInteractionManager();
        let cancelRunningCalled = false;
        let abortCalled = false;

        const superseded = supersedeStalledInteraction(
            {
                runningEntry: { requestId: "req-1" }, // blockedOn undefined
                pendingInteractions,
                abortRequest: () => {
                    abortCalled = true;
                },
                cancelRunning: () => {
                    cancelRunningCalled = true;
                },
                onInteractionCancelled: () => {},
            },
            "Superseded",
        );

        expect(superseded).toBe(false);
        expect(cancelRunningCalled).toBe(false);
        expect(abortCalled).toBe(false);
    });

    test("no-op when the queue is idle (no running head)", () => {
        const superseded = supersedeStalledInteraction(
            {
                runningEntry: null,
                pendingInteractions: new PendingInteractionManager(),
                abortRequest: () => {
                    throw new Error("should not abort when idle");
                },
                cancelRunning: () => {
                    throw new Error("should not cancel when idle");
                },
                onInteractionCancelled: () => {},
            },
            "Superseded",
        );
        expect(superseded).toBe(false);
    });

    test("still cancels the request even when no pending interaction matches its id", () => {
        // Head is blocked, but the only pending interaction belongs to a
        // different request (e.g. a peer's). Leave it untouched but still
        // unwind the blocked head so the queue advances.
        const pendingInteractions = new PendingInteractionManager();
        const other = pendingInteractions.create(
            questionRequest("i2", "other-req"),
        );
        other.catch(() => {});

        const cancelledInteractionIds: string[] = [];
        const controller = new AbortController();
        let cancelledRunning: string | undefined;

        const superseded = supersedeStalledInteraction(
            {
                runningEntry: { requestId: "req-1", blockedOn: "interaction" },
                pendingInteractions,
                abortRequest: () => controller.abort(),
                cancelRunning: (r) => {
                    cancelledRunning = r;
                },
                onInteractionCancelled: (id) =>
                    cancelledInteractionIds.push(id),
            },
            "Superseded",
        );

        expect(superseded).toBe(true);
        expect(cancelledInteractionIds).toEqual([]);
        expect(cancelledRunning).toBe("req-1");
        expect(controller.signal.aborted).toBe(true);
        // The other request's interaction is left pending.
        expect(pendingInteractions.has("i2")).toBe(true);

        pendingInteractions.cancel("i2", new Error("cleanup"));
    });
});
