// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PendingInteractionRequest } from "@typeagent/dispatcher-types";
import { PendingInteractionManager } from "../src/context/pendingInteractionManager.js";

function makeAskYesNoRequest(
    overrides: Partial<PendingInteractionRequest & { type: "askYesNo" }> = {},
): PendingInteractionRequest & { type: "askYesNo" } {
    return {
        interactionId: overrides.interactionId ?? `ask-${Date.now()}`,
        type: "askYesNo",
        message: "Continue?",
        source: "test",
        timestamp: Date.now(),
        ...overrides,
    };
}

function makeProposeActionRequest(
    overrides: Partial<
        PendingInteractionRequest & { type: "proposeAction" }
    > = {},
): PendingInteractionRequest & { type: "proposeAction" } {
    return {
        interactionId: overrides.interactionId ?? `propose-${Date.now()}`,
        type: "proposeAction",
        actionTemplates: {
            templateAgentName: "testAgent",
            templateName: "testTemplate",
            templateData: { data: {} } as any,
            defaultTemplate: {} as any,
        },
        source: "test",
        timestamp: Date.now(),
        ...overrides,
    };
}

function makePopupQuestionRequest(
    overrides: Partial<
        PendingInteractionRequest & { type: "popupQuestion" }
    > = {},
): PendingInteractionRequest & { type: "popupQuestion" } {
    return {
        interactionId: overrides.interactionId ?? `popup-${Date.now()}`,
        type: "popupQuestion",
        message: "Pick one",
        choices: ["A", "B", "C"],
        source: "test",
        timestamp: Date.now(),
        ...overrides,
    };
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("PendingInteractionManager", () => {
    let manager: PendingInteractionManager;

    beforeEach(() => {
        manager = new PendingInteractionManager();
    });

    // ---------------------------------------------------------------
    // 1. create + resolve: resolves promise with the given value
    // ---------------------------------------------------------------
    describe("create + resolve", () => {
        it("resolves the promise with the given value and removes the entry", async () => {
            const request = makeAskYesNoRequest({
                interactionId: "id-1",
            });
            const promise = manager.create<boolean>(request);

            expect(manager.has("id-1")).toBe(true);
            expect(manager.size).toBe(1);

            const resolved = manager.resolve("id-1", true);

            expect(resolved).toBe(true);
            await expect(promise).resolves.toBe(true);
            expect(manager.has("id-1")).toBe(false);
            expect(manager.size).toBe(0);
        });

        // ---------------------------------------------------------------
        // 2. resolve returns false for unknown interactionId
        // ---------------------------------------------------------------
        it("returns false when resolving an unknown interactionId", () => {
            expect(manager.resolve("nonexistent", 42)).toBe(false);
        });
    });

    // ---------------------------------------------------------------
    // 3. create + cancel: rejects promise with error, returns true
    // ---------------------------------------------------------------
    describe("create + cancel", () => {
        it("rejects the promise with the given error for proposeAction", async () => {
            const request = makeProposeActionRequest({
                interactionId: "id-2",
            });
            const promise = manager.create<unknown>(request);

            const cancelled = manager.cancel(
                "id-2",
                new Error("user cancelled"),
            );

            expect(cancelled).toBe(true);
            await expect(promise).rejects.toThrow("user cancelled");
            expect(manager.has("id-2")).toBe(false);
            expect(manager.size).toBe(0);
        });

        // ---------------------------------------------------------------
        // 4. cancel returns false for unknown interactionId
        // ---------------------------------------------------------------
        it("returns false when cancelling an unknown interactionId", () => {
            expect(manager.cancel("nonexistent", new Error("gone"))).toBe(
                false,
            );
        });

        // ---------------------------------------------------------------
        // 5. cancel: all three types behave correctly
        //    - askYesNo resolves with defaultValue if explicitly set, rejects otherwise
        //    - proposeAction rejects
        //    - popupQuestion rejects
        // ---------------------------------------------------------------
        it("askYesNo cancel resolves with defaultValue instead of rejecting", async () => {
            const request = makeAskYesNoRequest({
                interactionId: "yn-default-true",
                defaultValue: true,
            });
            const promise = manager.create<boolean>(request);

            manager.cancel("yn-default-true", new Error("disconnected"));

            // askYesNo resolves with the stored defaultValue
            await expect(promise).resolves.toBe(true);
        });

        it("askYesNo cancel rejects with the error when no defaultValue is set", async () => {
            const request = makeAskYesNoRequest({
                interactionId: "yn-no-default",
            });
            const promise = manager.create<boolean>(request);

            manager.cancel("yn-no-default", new Error("disconnected"));

            await expect(promise).rejects.toThrow("disconnected");
        });

        it("proposeAction cancel rejects with the error", async () => {
            const request = makeProposeActionRequest({
                interactionId: "pa-cancel",
            });
            const promise = manager.create<unknown>(request);

            manager.cancel("pa-cancel", new Error("aborted"));

            await expect(promise).rejects.toThrow("aborted");
        });

        it("popupQuestion cancel rejects with the error", async () => {
            const request = makePopupQuestionRequest({
                interactionId: "pq-cancel",
            });
            const promise = manager.create<number>(request);

            manager.cancel("pq-cancel", new Error("timeout"));

            await expect(promise).rejects.toThrow("timeout");
        });
    });

    // ---------------------------------------------------------------
    // 6. timeout: fires cancel after timeoutMs, rejects promise
    // ---------------------------------------------------------------
    describe("timeout", () => {
        it("rejects the promise after timeoutMs for proposeAction", async () => {
            const request = makeProposeActionRequest({
                interactionId: "timeout-1",
            });
            const promise = manager.create<unknown>(request, 10);

            expect(manager.has("timeout-1")).toBe(true);

            await expect(promise).rejects.toThrow("Interaction timed out");
            expect(manager.has("timeout-1")).toBe(false);
        });

        it("resolves askYesNo with default on timeout instead of rejecting", async () => {
            const request = makeAskYesNoRequest({
                interactionId: "timeout-yn",
                defaultValue: true,
            });
            const promise = manager.create<boolean>(request, 10);

            await expect(promise).resolves.toBe(true);
        });

        // ---------------------------------------------------------------
        // 7. timeout cleared when resolved before it fires
        // ---------------------------------------------------------------
        it("does not fire timeout after the interaction is resolved", async () => {
            const request = makeProposeActionRequest({
                interactionId: "no-spurious",
            });
            const promise = manager.create<unknown>(request, 50);

            // Resolve before the timer fires
            manager.resolve("no-spurious", { action: "done" });

            await expect(promise).resolves.toEqual({ action: "done" });

            // Wait past the original timeout to ensure no spurious effects
            await delay(80);

            expect(manager.has("no-spurious")).toBe(false);
            expect(manager.size).toBe(0);
        });

        it("does not fire timeout after the interaction is cancelled", async () => {
            const request = makeProposeActionRequest({
                interactionId: "cancel-before-timeout",
            });
            const promise = manager.create<unknown>(request, 50);

            manager.cancel("cancel-before-timeout", new Error("early cancel"));

            await expect(promise).rejects.toThrow("early cancel");

            // Wait past the original timeout to ensure no spurious effects
            await delay(80);

            expect(manager.size).toBe(0);
        });
    });

    // ---------------------------------------------------------------
    // 8. getPending: returns all current pending requests
    // ---------------------------------------------------------------
    describe("getPending", () => {
        it("returns all current pending requests", () => {
            const req1 = makeAskYesNoRequest({
                interactionId: "pending-1",
            });
            const req2 = makeProposeActionRequest({
                interactionId: "pending-2",
            });
            const req3 = makePopupQuestionRequest({
                interactionId: "pending-3",
            });

            manager.create<boolean>(req1);
            manager.create<unknown>(req2);
            manager.create<number>(req3);

            const pending = manager.getPending();

            expect(pending).toHaveLength(3);

            const ids = pending.map((r) => r.interactionId).sort();
            expect(ids).toEqual(["pending-1", "pending-2", "pending-3"]);

            // Verify the full request objects are returned
            const askReq = pending.find((r) => r.interactionId === "pending-1");
            expect(askReq?.type).toBe("askYesNo");
            expect(askReq?.source).toBe("test");
        });

        // ---------------------------------------------------------------
        // 9. getPending: returns empty after all resolved
        // ---------------------------------------------------------------
        it("returns empty array after all interactions are resolved", () => {
            const req1 = makeAskYesNoRequest({
                interactionId: "r-1",
            });
            const req2 = makeProposeActionRequest({
                interactionId: "r-2",
            });

            manager.create<boolean>(req1);
            manager.create<unknown>(req2);

            manager.resolve("r-1", true);
            manager.resolve("r-2", {});

            expect(manager.getPending()).toEqual([]);
        });
    });

    // ---------------------------------------------------------------
    // 10. has / size: reflect current state correctly
    // ---------------------------------------------------------------
    describe("has and size", () => {
        it("has returns true for pending and false after resolution", () => {
            const request = makeAskYesNoRequest({
                interactionId: "check-has",
            });
            manager.create<boolean>(request);

            expect(manager.has("check-has")).toBe(true);
            expect(manager.has("other")).toBe(false);

            manager.resolve("check-has", false);

            expect(manager.has("check-has")).toBe(false);
        });

        it("size tracks additions and removals accurately", async () => {
            expect(manager.size).toBe(0);

            const req1 = makeAskYesNoRequest({
                interactionId: "s-1",
            });
            const req2 = makeProposeActionRequest({
                interactionId: "s-2",
            });
            const req3 = makePopupQuestionRequest({
                interactionId: "s-3",
            });

            const p1 = manager.create<boolean>(req1);
            expect(manager.size).toBe(1);

            const p2 = manager.create<unknown>(req2);
            const p3 = manager.create<number>(req3);
            expect(manager.size).toBe(3);

            manager.resolve("s-1", true);
            expect(manager.size).toBe(2);
            await expect(p1).resolves.toBe(true);

            manager.cancel("s-2", new Error("cancelled"));
            expect(manager.size).toBe(1);
            await expect(p2).rejects.toThrow("cancelled");

            manager.cancel("s-3", new Error("cancelled"));
            expect(manager.size).toBe(0);
            await expect(p3).rejects.toThrow("cancelled");
        });
    });

    // ---------------------------------------------------------------
    // 11. cancelAll: rejects all pending interactions
    // ---------------------------------------------------------------
    describe("cancelAll", () => {
        it("rejects all pending interactions and empties the manager", async () => {
            const req1 = makeProposeActionRequest({
                interactionId: "all-1",
            });
            const req2 = makePopupQuestionRequest({
                interactionId: "all-2",
            });
            const req3 = makeAskYesNoRequest({
                interactionId: "all-3",
                defaultValue: true,
            });

            const p1 = manager.create<unknown>(req1);
            const p2 = manager.create<number>(req2);
            const p3 = manager.create<boolean>(req3);

            expect(manager.size).toBe(3);

            manager.cancelAll(new Error("shutting down"));

            expect(manager.size).toBe(0);

            // proposeAction and popupQuestion reject
            await expect(p1).rejects.toThrow("shutting down");
            await expect(p2).rejects.toThrow("shutting down");

            // askYesNo resolves with defaultValue
            await expect(p3).resolves.toBe(true);
        });

        it("is a no-op when there are no pending interactions", () => {
            expect(manager.size).toBe(0);
            manager.cancelAll(new Error("nothing"));
            expect(manager.size).toBe(0);
        });
    });

    // ---------------------------------------------------------------
    // Additional edge cases
    // ---------------------------------------------------------------
    describe("edge cases", () => {
        it("stores requestId from the request", () => {
            const request = makeAskYesNoRequest({
                interactionId: "with-rid",
                requestId: "req-42" as any,
            });

            manager.create<boolean>(request);

            const pending = manager.getPending();
            expect(pending[0].requestId).toBe("req-42");
        });

        it("does not set timeout when timeoutMs is 0", async () => {
            const request = makeProposeActionRequest({
                interactionId: "no-timeout",
            });
            manager.create<unknown>(request, 0);

            // Wait long enough that any real timeout would have fired
            await delay(20);

            // Still pending — no timeout was set
            expect(manager.has("no-timeout")).toBe(true);
        });

        it("does not set timeout when timeoutMs is undefined", async () => {
            const request = makeProposeActionRequest({
                interactionId: "undef-timeout",
            });
            manager.create<unknown>(request, undefined);

            // Wait long enough that any real timeout would have fired
            await delay(20);

            expect(manager.has("undef-timeout")).toBe(true);
        });
    });
});
