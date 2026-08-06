// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createTelemetryLifecycle,
    TelemetryLifecycleClosedError,
    TelemetryShutdownTimeoutError,
} from "../src/otel/lifecycle.js";

describe("TelemetryLifecycle", () => {
    it("starts open and not shutting down", () => {
        const lifecycle = createTelemetryLifecycle();
        expect(lifecycle.isShuttingDown).toBe(false);
        expect(lifecycle.isShutdown).toBe(false);
    });

    it("shuts down registered components in reverse registration order", async () => {
        const lifecycle = createTelemetryLifecycle();
        const order: string[] = [];
        lifecycle.register("first", () => {
            order.push("first");
        });
        lifecycle.register("second", () => {
            order.push("second");
        });
        lifecycle.register("third", async () => {
            await Promise.resolve();
            order.push("third");
        });

        await lifecycle.shutdown();

        expect(order).toEqual(["third", "second", "first"]);
        expect(lifecycle.isShuttingDown).toBe(true);
        expect(lifecycle.isShutdown).toBe(true);
    });

    it("rejects registration once shutdown has begun", async () => {
        const lifecycle = createTelemetryLifecycle();
        lifecycle.register("component", () => {});

        const shutdownPromise = lifecycle.shutdown();
        expect(() => lifecycle.register("late", () => {})).toThrow(
            TelemetryLifecycleClosedError,
        );

        await shutdownPromise;

        expect(() => lifecycle.register("later", () => {})).toThrow(
            TelemetryLifecycleClosedError,
        );
    });

    it("rejects synchronous re-entrant registration from a shutdown callback", async () => {
        const lifecycle = createTelemetryLifecycle();
        const order: string[] = [];
        let reentrantRegisterThrew: unknown;

        // "first" runs last (reverse registration order); "second" runs
        // first and synchronously tries to register a new component while
        // shutdown() is still in the middle of its own synchronous call
        // stack (i.e. before shutdown() itself has returned).
        lifecycle.register("first", () => {
            order.push("first");
        });
        lifecycle.register("second", () => {
            order.push("second");
            try {
                lifecycle.register("reentrant", () => {
                    order.push("reentrant");
                });
            } catch (error) {
                reentrantRegisterThrew = error;
            }
        });

        await lifecycle.shutdown();

        expect(reentrantRegisterThrew).toBeInstanceOf(
            TelemetryLifecycleClosedError,
        );
        // The rejected component must never have been registered, let
        // alone run.
        expect(order).toEqual(["second", "first"]);
    });

    it("is idempotent: repeated shutdown() calls do not re-run callbacks", async () => {
        const lifecycle = createTelemetryLifecycle();
        let callCount = 0;
        lifecycle.register("component", () => {
            callCount++;
        });

        const first = lifecycle.shutdown();
        const second = lifecycle.shutdown();

        expect(first).toBe(second);
        await first;
        await lifecycle.shutdown();

        expect(callCount).toBe(1);
    });

    it("does not re-run callbacks for re-entrant shutdown()", async () => {
        const lifecycle = createTelemetryLifecycle();
        let callCount = 0;
        let reentrantShutdown: Promise<void> | undefined;
        lifecycle.register("component", () => {
            callCount++;
            reentrantShutdown = lifecycle.shutdown();
        });

        const shutdown = lifecycle.shutdown();
        await shutdown;

        expect(reentrantShutdown).toBe(shutdown);
        expect(callCount).toBe(1);
    });

    it("continues shutting down remaining components after a failure and surfaces it", async () => {
        const lifecycle = createTelemetryLifecycle();
        let ranAfterFailureCount = 0;
        lifecycle.register("willRun", () => {
            ranAfterFailureCount++;
        });
        lifecycle.register("willFail", () => {
            throw new Error("boom");
        });
        lifecycle.register("alsoFails", async () => {
            throw new Error("also boom");
        });

        await expect(lifecycle.shutdown()).rejects.toThrow(AggregateError);
        expect(ranAfterFailureCount).toBe(1);

        try {
            await lifecycle.shutdown();
            throw new Error("expected shutdown() to reject");
        } catch (error) {
            expect(error).toBeInstanceOf(AggregateError);
            expect((error as AggregateError).errors).toHaveLength(2);
        }
    });

    it("times out a hung component and continues shutdown", async () => {
        const lifecycle = createTelemetryLifecycle({
            componentTimeoutMs: 10,
        });
        let remainingComponentRan = false;
        lifecycle.register("remaining", () => {
            remainingComponentRan = true;
        });
        lifecycle.register("hung", () => new Promise<void>(() => undefined));

        await expect(lifecycle.shutdown()).rejects.toMatchObject({
            errors: [expect.any(TelemetryShutdownTimeoutError)],
        });
        expect(remainingComponentRan).toBe(true);
        expect(lifecycle.isShutdown).toBe(true);
    });

    it("rejects an invalid component timeout", () => {
        expect(() =>
            createTelemetryLifecycle({ componentTimeoutMs: 0 }),
        ).toThrow(/positive finite number/);
    });

    it("bounds the total shutdown time across components", async () => {
        const lifecycle = createTelemetryLifecycle({
            totalTimeoutMs: 20,
            componentTimeoutMs: 100,
        });
        let remainingComponentRan = false;
        lifecycle.register("remaining", () => {
            remainingComponentRan = true;
        });
        lifecycle.register("hung", () => new Promise<void>(() => undefined));

        try {
            await lifecycle.shutdown();
            throw new Error("expected shutdown() to reject");
        } catch (error) {
            expect(error).toBeInstanceOf(AggregateError);
            expect((error as AggregateError).errors).toHaveLength(2);
        }
        expect(remainingComponentRan).toBe(false);
    });

    it("rejects an invalid total timeout", () => {
        expect(() => createTelemetryLifecycle({ totalTimeoutMs: 0 })).toThrow(
            /positive finite number/,
        );
    });
});
