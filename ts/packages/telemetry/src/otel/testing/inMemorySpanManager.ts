// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { context, trace } from "@opentelemetry/api";
import {
    InMemorySpanExporter,
    SimpleSpanProcessor,
    type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

/**
 * Test-only in-memory span manager. Not shipped by the main package entry
 * point - imported from `@typeagent/telemetry/testing/inMemorySpanManager`
 * (dist path) or directly from source in this package's own specs.
 *
 * The manager stands up a temporary `BasicTracerProvider` with an
 * `InMemorySpanExporter` behind a `SimpleSpanProcessor`, registers it as
 * the global OTel tracer provider, and offers helpers to inspect and assert
 * over the captured spans. Teardown restores the previous global provider
 * exactly, so a spec that installs a manager cannot leak state into the
 * next spec.
 */

/**
 * A snapshot of an OTel span as captured by the in-memory exporter. Aliased
 * so specs do not need a direct dependency on `@opentelemetry/sdk-trace-base`
 * types.
 */
export type CapturedSpan = ReadableSpan;

/** Handle returned by {@link createInMemorySpanManager}. */
export interface InMemorySpanManager {
    /**
     * The temporary tracer provider registered as the OTel global. Exposed
     * only for tests that need to hand this exact provider to code under
     * test that expects an explicit provider.
     */
    readonly provider: NodeTracerProvider;

    /** The underlying in-memory exporter, mainly exposed for advanced assertions. */
    readonly exporter: InMemorySpanExporter;

    /**
     * Return every finished span captured so far, in export order. A defensive
     * copy is returned so a caller's array manipulation cannot mutate exporter
     * state.
     */
    getFinishedSpans(): CapturedSpan[];

    /**
     * Return every finished span whose name equals `name`. Convenience wrapper
     * over {@link getFinishedSpans}. Returns an empty array (not `undefined`)
     * when nothing matched.
     */
    findSpansByName(name: string): CapturedSpan[];

    /**
     * Assert that `child` is a direct child of `parent` in the captured trace:
     * both spans share the same trace id, and `child`'s recorded parent span
     * id equals `parent.spanContext().spanId`. Throws an `Error` with a
     * descriptive message otherwise.
     */
    assertParentChild(parent: CapturedSpan, child: CapturedSpan): void;

    /**
     * Drop every captured span. Does not touch the global provider - the
     * provider remains installed and further spans can still be captured.
     */
    reset(): void;

    /**
     * Tear the manager down: shut down the provider and restore the tracer
     * provider that was global before this manager was installed. Idempotent
     * - a second call is a no-op. Returns a promise that resolves after the
     * underlying SDK shutdown completes.
     */
    shutdown(): Promise<void>;
}

/**
 * Install a temporary in-memory OTel tracer provider globally and return a
 * manager that can inspect the captured spans. Always call `shutdown()` in
 * the spec's `afterEach`/`afterAll` (or a `try/finally`) to restore the
 * previous global provider.
 */
export function createInMemorySpanManager(): InMemorySpanManager {
    const exporter = new InMemorySpanExporter();
    const processor = new SimpleSpanProcessor(exporter);
    const provider = new NodeTracerProvider({
        spanProcessors: [processor],
    });

    // `provider.register()` sets the global tracer provider and installs a
    // Node AsyncHooks context manager so `startActiveSpan` correctly parents
    // nested async work. Propagation is disabled because this manager does not
    // test carrier injection and must not leak a global propagator. It returns
    // void, so detect an already-registered provider ahead of time and fail
    // loudly instead of silently no-oping.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingDelegate = (trace.getTracerProvider() as any).getDelegate?.();
    if (
        existingDelegate !== undefined &&
        !isNoopTracerProvider(existingDelegate)
    ) {
        throw new Error(
            "createInMemorySpanManager: an OTel tracer provider is already " +
                "globally registered. Call trace.disable() (or shut down the " +
                "previous provider) before installing this manager.",
        );
    }
    provider.register({ propagator: null });

    let shutdownPromise: Promise<void> | undefined;

    return {
        provider,
        exporter,
        getFinishedSpans(): CapturedSpan[] {
            return exporter.getFinishedSpans().slice();
        },
        findSpansByName(name: string): CapturedSpan[] {
            return exporter
                .getFinishedSpans()
                .filter((span) => span.name === name);
        },
        assertParentChild(parent: CapturedSpan, child: CapturedSpan): void {
            const parentCtx = parent.spanContext();
            const childCtx = child.spanContext();
            if (parentCtx.traceId !== childCtx.traceId) {
                throw new Error(
                    `Expected spans "${parent.name}" and "${child.name}" to share a trace id, ` +
                        `but got parent traceId=${parentCtx.traceId}, child traceId=${childCtx.traceId}.`,
                );
            }
            const childParentSpanId = readParentSpanId(child);
            if (childParentSpanId === undefined) {
                throw new Error(
                    `Expected child span "${child.name}" to have a parent span id, but it had none.`,
                );
            }
            if (childParentSpanId !== parentCtx.spanId) {
                throw new Error(
                    `Expected child span "${child.name}" parent span id ${childParentSpanId} ` +
                        `to equal parent span "${parent.name}" span id ${parentCtx.spanId}.`,
                );
            }
        },
        reset(): void {
            exporter.reset();
        },
        shutdown(): Promise<void> {
            // Cache the shutdown promise so overlapping callers (e.g. a
            // second `Promise.all([m.shutdown(), m.shutdown()])`) all wait
            // for the same completion instead of racing the global-provider
            // reset.
            if (shutdownPromise === undefined) {
                shutdownPromise = (async () => {
                    try {
                        await provider.shutdown();
                    } finally {
                        // Unregister the tracer provider and the AsyncHooks
                        // context manager `provider.register()` installed so
                        // the next manager install (or any other caller)
                        // sees a clean "no provider set" state.
                        trace.disable();
                        context.disable();
                    }
                })();
            }
            return shutdownPromise;
        },
    };
}

/**
 * Best-effort detection of the API's built-in NoopTracerProvider. Used only
 * to decide whether an *already-registered* global provider is a real one
 * that would silently swallow our install. This is intentionally lenient:
 * the alternative to a false negative here (throwing when the existing
 * provider actually is noop) is silently no-oping, which is worse.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isNoopTracerProvider(candidate: any): boolean {
    if (candidate === null || candidate === undefined) {
        return true;
    }
    const ctorName = candidate.constructor?.name;
    return ctorName === "NoopTracerProvider";
}

/**
 * Read the parent span id from a captured span. The `ReadableSpan` interface
 * has evolved across SDK versions: v1 exposed `parentSpanId`, and v2 uses
 * `parentSpanContext.spanId`. Check both so the manager stays compatible
 * with either shape without pinning a specific runtime property.
 */
function readParentSpanId(span: CapturedSpan): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anySpan = span as any;
    if (typeof anySpan.parentSpanId === "string") {
        return anySpan.parentSpanId;
    }
    const ctx = anySpan.parentSpanContext;
    if (ctx && typeof ctx.spanId === "string") {
        return ctx.spanId;
    }
    return undefined;
}
