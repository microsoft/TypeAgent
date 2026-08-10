// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import {
    createInMemorySpanManager,
    type InMemorySpanManager,
} from "@typeagent/telemetry/testing/inMemorySpanManager";
import { wrapRootRequestSpan } from "../src/otel/rootRequestSpan.js";

// Spec for the dispatcher root request span. Assertions target only the
// contract wrapRootRequestSpan owns: name, correlation attributes at open,
// status semantics, exception-recording, and end-exactly-once behavior on
// success / thrown / cancellation / converted-failure paths.

const ATTRS = {
    sessionId: "session-abc",
    activationId: "act-123",
    traceId: "trace-xyz",
};

function findRequestSpan(manager: InMemorySpanManager) {
    const spans = manager.findSpansByName("typeagent.request");
    if (spans.length !== 1) {
        throw new Error(
            `Expected exactly one typeagent.request span, got ${spans.length}`,
        );
    }
    return spans[0]!;
}

describe("wrapRootRequestSpan", () => {
    let manager: InMemorySpanManager;

    beforeEach(() => {
        manager = createInMemorySpanManager();
    });

    afterEach(async () => {
        await manager.shutdown();
    });

    it("produces exactly one root span named typeagent.request per invocation", async () => {
        await wrapRootRequestSpan(ATTRS, async () => ({}));
        const spans = manager.getFinishedSpans();
        expect(spans).toHaveLength(1);
        expect(spans[0]!.name).toBe("typeagent.request");
    });

    it("stamps the correlation attributes from the request context onto the root span", async () => {
        await wrapRootRequestSpan(ATTRS, async () => ({}));
        const span = findRequestSpan(manager);
        expect(span.attributes["typeagent.session.id"]).toBe("session-abc");
        expect(span.attributes["typeagent.activation.id"]).toBe("act-123");
        expect(span.attributes["typeagent.trace.id"]).toBe("trace-xyz");
    });

    it("only writes the attributes the caller supplies (undefined values are dropped)", async () => {
        await wrapRootRequestSpan(
            { sessionId: "only-session" },
            async () => ({}),
        );
        const span = findRequestSpan(manager);
        expect(span.attributes["typeagent.session.id"]).toBe("only-session");
        expect(span.attributes["typeagent.activation.id"]).toBeUndefined();
        expect(span.attributes["typeagent.trace.id"]).toBeUndefined();
    });

    it("leaves status UNSET and records no exception event on the success path", async () => {
        await wrapRootRequestSpan(ATTRS, async () => ({}));
        const span = findRequestSpan(manager);
        expect(span.status.code).toBe(SpanStatusCode.UNSET);
        expect(span.events.some((e) => e.name === "exception")).toBe(false);
    });

    it("sets ERROR status with 'cancelled' when the body returns a result with cancelled === true", async () => {
        await wrapRootRequestSpan(ATTRS, async () => ({ cancelled: true }));
        const span = findRequestSpan(manager);
        expect(span.status.code).toBe(SpanStatusCode.ERROR);
        expect(span.status.message).toBe("cancelled");
        // Converted-failure path: the wrapper itself does not synthesise an
        // exception event. Callers that converted a real exception to
        // cancelled record the exception on the active span themselves
        // (see the converted-failure test below).
        expect(span.events.some((e) => e.name === "exception")).toBe(false);
    });

    it("preserves an exception the body recorded on the active span before returning cancelled", async () => {
        // Mirrors what processCommand does when it catches an AbortError
        // and converts it to `commandResult.cancelled = true`: it captures
        // the exception on the *active* span (via trace.getActiveSpan())
        // *inside* the wrapper's callback, so the exception event lands on
        // `typeagent.request` alongside the wrapper's ERROR "cancelled"
        // status. This matches the design doc rule that failures converted
        // to ActionResult must still record the exception.
        const abort = new DOMException(
            "The operation was aborted.",
            "AbortError",
        );
        await wrapRootRequestSpan(ATTRS, async () => {
            trace.getActiveSpan()?.recordException(abort);
            return { cancelled: true };
        });
        const span = findRequestSpan(manager);
        expect(span.status.code).toBe(SpanStatusCode.ERROR);
        expect(span.status.message).toBe("cancelled");
        const exceptionEvent = span.events.find((e) => e.name === "exception");
        expect(exceptionEvent).toBeDefined();
        expect(exceptionEvent!.attributes?.["exception.message"]).toBe(
            "The operation was aborted.",
        );
    });

    it("records the exception and sets ERROR status when the body throws", async () => {
        const err = new Error("boom");
        await expect(
            wrapRootRequestSpan(ATTRS, async () => {
                throw err;
            }),
        ).rejects.toBe(err);
        const span = findRequestSpan(manager);
        expect(span.status.code).toBe(SpanStatusCode.ERROR);
        expect(span.status.message).toBe("request failed");
        const exceptionEvent = span.events.find((e) => e.name === "exception");
        expect(exceptionEvent).toBeDefined();
        expect(exceptionEvent!.attributes?.["exception.type"]).toBe(
            "RequestError",
        );
        expect(exceptionEvent!.attributes?.["exception.message"]).toBe(
            "request failed",
        );
        expect(
            exceptionEvent!.attributes?.["exception.stacktrace"],
        ).toBeUndefined();
    });

    it("records redacted original exception details only when explicitly enabled", async () => {
        const err = new Error("boom with user content");
        await expect(
            wrapRootRequestSpan(
                ATTRS,
                async () => {
                    throw err;
                },
                { captureSensitiveErrorDetails: true },
            ),
        ).rejects.toBe(err);
        const span = findRequestSpan(manager);
        expect(span.status.message).toBe("request failed");
        const exceptionEvent = span.events.find((e) => e.name === "exception");
        expect(exceptionEvent!.attributes?.["exception.message"]).toBe(
            "boom with user content",
        );
        expect(
            exceptionEvent!.attributes?.["exception.stacktrace"],
        ).toBeDefined();
    });

    it("maps a thrown AbortError to ERROR status message 'cancelled'", async () => {
        const abort = new DOMException(
            "The operation was aborted.",
            "AbortError",
        );
        await expect(
            wrapRootRequestSpan(ATTRS, async () => {
                throw abort;
            }),
        ).rejects.toBe(abort);
        const span = findRequestSpan(manager);
        expect(span.status.code).toBe(SpanStatusCode.ERROR);
        expect(span.status.message).toBe("cancelled");
    });

    it("ends the span exactly once even when the callback throws synchronously inside the async body", async () => {
        const err = new Error("sync-in-async");
        await expect(
            wrapRootRequestSpan(ATTRS, async () => {
                throw err;
            }),
        ).rejects.toBe(err);
        // A second wrap opens a fresh span; if the first didn't end exactly
        // once we'd see stale unfinished state or a duplicate export.
        await wrapRootRequestSpan(ATTRS, async () => ({}));
        expect(manager.getFinishedSpans()).toHaveLength(2);
    });

    it("propagates the active span through nested awaits (AsyncHooks-based context)", async () => {
        let observedTraceId: string | undefined;
        let observedSpanId: string | undefined;
        await wrapRootRequestSpan(ATTRS, async () => {
            // Two microtask hops to force async context to persist across
            // await boundaries; this is the property the Steps 3-6 child
            // spans rely on.
            await Promise.resolve();
            await Promise.resolve();
            const active = trace.getActiveSpan();
            if (active) {
                const ctx = active.spanContext();
                observedTraceId = ctx.traceId;
                observedSpanId = ctx.spanId;
            }
            return {};
        });
        const span = findRequestSpan(manager);
        expect(observedTraceId).toBe(span.spanContext().traceId);
        expect(observedSpanId).toBe(span.spanContext().spanId);
    });

    it("starts a new trace instead of inheriting unrelated ambient context by default", async () => {
        const tracer = trace.getTracer("test");
        await tracer.startActiveSpan("unrelated.outer", async (outer) => {
            await wrapRootRequestSpan(ATTRS, async () => ({}));
            outer.end();
        });

        const [outer] = manager.findSpansByName("unrelated.outer");
        const request = findRequestSpan(manager);
        expect(request.spanContext().traceId).not.toBe(
            outer.spanContext().traceId,
        );
    });

    it("joins an explicitly provided active context", async () => {
        const tracer = trace.getTracer("test");
        await tracer.startActiveSpan("host.request", async (host) => {
            await wrapRootRequestSpan(ATTRS, async () => ({}), {
                parentContext: context.active(),
            });
            host.end();
        });

        const [host] = manager.findSpansByName("host.request");
        const request = findRequestSpan(manager);
        manager.assertParentChild(host, request);
    });

    it("returns the body's result value unchanged on success", async () => {
        const result = await wrapRootRequestSpan(ATTRS, async () => ({
            lastError: "no cache match",
            cancelled: false as const,
        }));
        expect(result).toEqual({
            lastError: "no cache match",
            cancelled: false,
        });
    });

    it("does not mark a distinct, unrelated flag on the result as cancellation", async () => {
        // Guard against a future edit that mistakenly widens the "converted
        // failure" probe. Only cancelled === true is a caller-visible
        // failure signal; other result fields must not affect span status.
        await wrapRootRequestSpan(ATTRS, async () => ({
            cancelled: false,
        }));
        const span = findRequestSpan(manager);
        expect(span.status.code).toBe(SpanStatusCode.UNSET);
    });

    it("preserves an ERROR status the body set on the active span (swallowed non-abort exception path)", async () => {
        // Mirrors processCommandNoLock's non-abort catch: it swallows the
        // exception (converts to a user-visible display + logged event)
        // rather than rethrowing. Before it swallows, it records the
        // exception AND sets status ERROR on the active `typeagent.request`
        // span. The wrapper must NOT clobber that back to UNSET on the
        // success return path.
        await wrapRootRequestSpan(ATTRS, async () => {
            const active = trace.getActiveSpan();
            active?.recordException(new Error("translation failed"));
            active?.setStatus({
                code: SpanStatusCode.ERROR,
                message: "translation failed",
            });
            // Body returns normally with no cancelled flag - matches the
            // real dispatcher flow where processCommandNoLock's catch
            // returns undefined and processCommand still returns a result.
            return {};
        });
        const span = findRequestSpan(manager);
        expect(span.status.code).toBe(SpanStatusCode.ERROR);
        expect(span.status.message).toBe("translation failed");
        const exceptionEvent = span.events.find((e) => e.name === "exception");
        expect(exceptionEvent).toBeDefined();
        expect(exceptionEvent!.attributes?.["exception.message"]).toBe(
            "translation failed",
        );
    });
});
