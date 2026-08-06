// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A minimal ownership/lifecycle primitive for TypeAgent-owned telemetry
 * components (providers, processors, exporters, file writers, debug-hook
 * restorers, etc.).
 *
 * This module only tracks registered components and shuts them down; it does
 * not install signal handlers and does not know about any specific OTel
 * provider. Wiring `shutdown()` into process exit and `SIGINT`/`SIGTERM`
 * handling is the caller's responsibility.
 */

/** An async (or sync) teardown action for one TypeAgent-owned component. */
export type ShutdownCallback = () => void | Promise<void>;

/** Options for {@link createTelemetryLifecycle}. */
export interface TelemetryLifecycleOptions {
    /**
     * Maximum total time allowed for telemetry shutdown.
     * Defaults to 10 seconds.
     */
    readonly totalTimeoutMs?: number;
    /**
     * Maximum time allowed for each component's shutdown callback.
     * Defaults to 5 seconds.
     */
    readonly componentTimeoutMs?: number;
}

/** Error recorded when a component exceeds its shutdown deadline. */
export class TelemetryShutdownTimeoutError extends Error {
    constructor(name: string, timeoutMs: number) {
        super(
            `Telemetry component "${name}" did not shut down within ${timeoutMs} ms.`,
        );
        this.name = "TelemetryShutdownTimeoutError";
    }
}

/**
 * Thrown by {@link TelemetryLifecycle.register} once shutdown has begun or
 * completed. A component cannot be registered for a shutdown that will never
 * run it.
 */
export class TelemetryLifecycleClosedError extends Error {
    constructor(name: string) {
        super(
            `Cannot register telemetry component "${name}": the telemetry lifecycle is shutting down or has already shut down.`,
        );
        this.name = "TelemetryLifecycleClosedError";
    }
}

/**
 * Tracks TypeAgent-owned telemetry components and shuts them down together.
 *
 * `register()` and `shutdown()` are the only ways to affect ownership. There
 * is no way to unregister a component or to run `shutdown()` more than once;
 * repeated calls to `shutdown()` return the same settled outcome.
 */
export interface TelemetryLifecycle {
    /**
     * Register a component's shutdown callback. Callbacks run in reverse
     * registration order (last registered, first shut down) so components
     * are torn down in the opposite order they were brought up.
     *
     * @throws {TelemetryLifecycleClosedError} if `shutdown()` has already
     * been called.
     */
    register(name: string, onShutdown: ShutdownCallback): void;

    /** `true` once `shutdown()` has been called, even before it settles. */
    readonly isShuttingDown: boolean;

    /** `true` once `shutdown()` has settled, successfully or not. */
    readonly isShutdown: boolean;

    /**
     * Shut down every registered component in reverse registration order.
     * A failing callback does not stop the remaining callbacks from running.
     *
     * Idempotent: the first call runs the registered callbacks; every call
     * (including the first) returns the same promise, so later callers
     * observe the same outcome without re-running anything.
     *
     * @throws {AggregateError} if one or more callbacks failed. All
     * callbacks still run to completion before this rejects.
     */
    shutdown(): Promise<void>;
}

interface RegisteredComponent {
    readonly name: string;
    readonly onShutdown: ShutdownCallback;
}

/** Create a new, empty {@link TelemetryLifecycle}. */
export function createTelemetryLifecycle(
    options: TelemetryLifecycleOptions = {},
): TelemetryLifecycle {
    const totalTimeoutMs = options.totalTimeoutMs ?? 10_000;
    const componentTimeoutMs = options.componentTimeoutMs ?? 5_000;
    if (!Number.isFinite(totalTimeoutMs) || totalTimeoutMs <= 0) {
        throw new Error(
            "Telemetry lifecycle totalTimeoutMs must be a positive finite number.",
        );
    }
    if (!Number.isFinite(componentTimeoutMs) || componentTimeoutMs <= 0) {
        throw new Error(
            "Telemetry lifecycle componentTimeoutMs must be a positive finite number.",
        );
    }
    const components: RegisteredComponent[] = [];
    let shuttingDown = false;
    let shutdownPromise: Promise<void> | undefined;
    let settled = false;

    async function runShutdown(): Promise<void> {
        const failures: unknown[] = [];
        const deadline = Date.now() + totalTimeoutMs;
        // Reverse registration order: the most recently registered
        // component (typically the one most dependent on earlier ones)
        // shuts down first.
        for (let i = components.length - 1; i >= 0; i--) {
            const component = components[i];
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
                failures.push(
                    new TelemetryShutdownTimeoutError(component.name, 0),
                );
                continue;
            }
            const timeoutMs = Math.min(componentTimeoutMs, remainingMs);
            try {
                let timeout: NodeJS.Timeout | undefined;
                try {
                    await Promise.race([
                        Promise.resolve().then(component.onShutdown),
                        new Promise<never>((_, reject) => {
                            timeout = setTimeout(() => {
                                reject(
                                    new TelemetryShutdownTimeoutError(
                                        component.name,
                                        timeoutMs,
                                    ),
                                );
                            }, timeoutMs);
                            timeout.unref();
                        }),
                    ]);
                } finally {
                    if (timeout !== undefined) {
                        clearTimeout(timeout);
                    }
                }
            } catch (error) {
                failures.push(
                    error instanceof Error
                        ? error
                        : new Error(
                              `Telemetry component "${component.name}" failed to shut down: ${String(error)}`,
                          ),
                );
            }
        }
        settled = true;
        if (failures.length > 0) {
            throw new AggregateError(
                failures,
                `${failures.length} telemetry component(s) failed to shut down.`,
            );
        }
    }

    return {
        register(name: string, onShutdown: ShutdownCallback): void {
            if (shuttingDown) {
                throw new TelemetryLifecycleClosedError(name);
            }
            components.push({ name, onShutdown });
        },

        get isShuttingDown(): boolean {
            return shuttingDown;
        },

        get isShutdown(): boolean {
            return settled;
        },

        shutdown(): Promise<void> {
            if (shutdownPromise === undefined) {
                shuttingDown = true;
                // Defer execution until after the promise is retained so
                // synchronous re-entrant register()/shutdown() calls observe
                // the lifecycle as closed and the same shutdown operation.
                shutdownPromise = Promise.resolve().then(runShutdown);
            }
            return shutdownPromise;
        },
    };
}
