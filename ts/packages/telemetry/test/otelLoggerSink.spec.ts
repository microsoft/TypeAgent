// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    context as otelContext,
    trace,
    ROOT_CONTEXT,
} from "@opentelemetry/api";
import {
    logs,
    SeverityNumber,
    type LogRecord as OtelLogRecord,
} from "@opentelemetry/api-logs";
import {
    InMemoryLogRecordExporter,
    LoggerProvider,
    SimpleLogRecordProcessor,
    type ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
    InMemorySpanExporter,
    SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { createSecretFilter } from "@typeagent/common-utils";

import {
    createOtelLoggerSink,
    OtelLoggerSink,
} from "../src/logger/otelLoggerSink.js";
import {
    MultiSinkLogger,
    type LogEvent,
    type LoggerSink,
} from "../src/logger/logger.js";
import {
    INSTRUMENTATION_SCOPE_NAME,
    INSTRUMENTATION_SCOPE_VERSION,
} from "../src/otel/instrumentation.js";
import { TYPEAGENT_SPAN_ATTRIBUTES } from "../src/otel/traceContract.js";

interface LogFixture {
    exporter: InMemoryLogRecordExporter;
    provider: LoggerProvider;
}

interface TraceFixture {
    exporter: InMemorySpanExporter;
    provider: NodeTracerProvider;
}

/**
 * Install a fresh OTel logs SDK backed by an in-memory exporter as the
 * process-global provider. Every spec that installs one calls the paired
 * `disposeLogFixture` in its own `afterEach` so the next spec sees clean
 * globals.
 */
function installLogFixture(): LogFixture {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({
        processors: [new SimpleLogRecordProcessor({ exporter })],
    });
    logs.setGlobalLoggerProvider(provider);
    return { exporter, provider };
}

async function disposeLogFixture(
    fixture: LogFixture | undefined,
): Promise<void> {
    if (fixture === undefined) {
        return;
    }
    try {
        await fixture.provider.forceFlush();
    } catch {
        // ignore
    }
    try {
        await fixture.provider.shutdown();
    } catch {
        // ignore
    }
    logs.disable();
}

function installTraceFixture(): TraceFixture {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    // Install a context manager so `startActiveSpan` actually propagates
    // through the emitting code. Skip a global propagator - the sink
    // relies only on `context.active()`.
    const contextManager = new AsyncLocalStorageContextManager();
    otelContext.setGlobalContextManager(contextManager.enable());
    trace.setGlobalTracerProvider(provider);
    return { exporter, provider };
}

async function disposeTraceFixture(
    fixture: TraceFixture | undefined,
): Promise<void> {
    if (fixture === undefined) {
        return;
    }
    try {
        await fixture.provider.forceFlush();
    } catch {
        // ignore
    }
    try {
        await fixture.provider.shutdown();
    } catch {
        // ignore
    }
    trace.disable();
    otelContext.disable();
}

function baseEvent(overrides?: Partial<LogEvent>): LogEvent {
    return {
        eventName: "test.event",
        timestamp: "2024-06-01T12:34:56.000Z",
        event: {},
        ...overrides,
    };
}

describe("OtelLoggerSink", () => {
    let logFixture: LogFixture | undefined;
    let traceFixture: TraceFixture | undefined;

    afterEach(async () => {
        await disposeLogFixture(logFixture);
        logFixture = undefined;
        await disposeTraceFixture(traceFixture);
        traceFixture = undefined;
    });

    it("maps a Structured Logger event to a complete OTel log record", () => {
        logFixture = installLogFixture();
        const sink = createOtelLoggerSink({
            diagnostic: () => undefined,
        });

        sink.logEvent(
            baseEvent({
                eventName: "translation.completed",
                timestamp: "2024-06-01T12:34:56.789Z",
                event: {
                    sessionId: "sess-1",
                    activationId: "act-1",
                    traceId: "trace-1",
                    stage: "translate",
                    tokens: 123,
                },
            }),
        );

        const records = logFixture.exporter.getFinishedLogRecords();
        expect(records).toHaveLength(1);
        const record = records[0]!;

        expect(record.eventName).toBe("translation.completed");
        expect(record.severityNumber).toBe(SeverityNumber.INFO);
        expect(record.severityText).toBe("INFO");
        expect(record.instrumentationScope.name).toBe(
            INSTRUMENTATION_SCOPE_NAME,
        );
        expect(record.instrumentationScope.version).toBe(
            INSTRUMENTATION_SCOPE_VERSION,
        );
        expect(record.body).toEqual({
            sessionId: "sess-1",
            activationId: "act-1",
            traceId: "trace-1",
            stage: "translate",
            tokens: 123,
        });
        // `hrTime` = [seconds, nanos]. 2024-06-01T12:34:56.789Z is
        // 1717245296.789 seconds since the epoch.
        expect(record.hrTime[0]).toBe(1717245296);
        expect(record.hrTime[1]).toBe(789_000_000);
        expect(record.hrTimeObserved[0]).toBeGreaterThan(0);
    });

    it("promotes only the allowlisted top-level string correlation fields", () => {
        logFixture = installLogFixture();
        const sink = createOtelLoggerSink();

        sink.logEvent(
            baseEvent({
                event: {
                    sessionId: "sess-2",
                    activationId: "act-2",
                    traceId: "trace-2",
                    // Ignored: nested container (structure, not a scalar).
                    nested: { sessionId: "nested-sess" },
                    // Ignored: not on the allowlist.
                    userText: "hello",
                    // Ignored: empty string.
                    emptyField: "",
                    // Ignored: non-string type.
                    count: 42,
                },
            }),
        );

        const record = logFixture.exporter.getFinishedLogRecords()[0]!;
        expect(record.attributes).toEqual({
            [TYPEAGENT_SPAN_ATTRIBUTES.SESSION_ID]: "sess-2",
            [TYPEAGENT_SPAN_ATTRIBUTES.ACTIVATION_ID]: "act-2",
            [TYPEAGENT_SPAN_ATTRIBUTES.TRACE_ID]: "trace-2",
        });
        // No smuggled keys.
        expect(Object.keys(record.attributes).sort()).toEqual(
            [
                TYPEAGENT_SPAN_ATTRIBUTES.SESSION_ID,
                TYPEAGENT_SPAN_ATTRIBUTES.ACTIVATION_ID,
                TYPEAGENT_SPAN_ATTRIBUTES.TRACE_ID,
            ].sort(),
        );
    });

    it("bounds the event name and promoted correlation values", () => {
        logFixture = installLogFixture();
        const sink = createOtelLoggerSink();
        const oversized = "x".repeat(1_000);

        sink.logEvent(
            baseEvent({
                eventName: oversized,
                event: {
                    sessionId: oversized,
                    activationId: oversized,
                    traceId: oversized,
                },
            }),
        );

        const record = logFixture.exporter.getFinishedLogRecords()[0]!;
        expect(record.eventName).toBe("typeagent.truncated_event_name");
        expect(record.attributes).toEqual({});
    });

    it("redacts secrets registered on the shared filter from body and attributes", () => {
        logFixture = installLogFixture();
        const secretFilter = createSecretFilter();
        secretFilter.addValue("hunter2-registered");
        const sink = createOtelLoggerSink({ secretFilter });

        sink.logEvent(
            baseEvent({
                event: {
                    sessionId: "hunter2-registered",
                    activationId: "act",
                    message: "leak=hunter2-registered",
                    tokens: 7,
                },
            }),
        );

        const record = logFixture.exporter.getFinishedLogRecords()[0]!;
        // Attribute is redacted.
        expect(
            record.attributes[TYPEAGENT_SPAN_ATTRIBUTES.SESSION_ID],
        ).not.toContain("hunter2-registered");
        expect(record.attributes[TYPEAGENT_SPAN_ATTRIBUTES.ACTIVATION_ID]).toBe(
            "act",
        );
        // Body is redacted.
        const body = record.body as Record<string, unknown>;
        expect(body.sessionId).not.toContain("hunter2-registered");
        expect(String(body.message)).not.toContain("hunter2-registered");
        // Non-string values are preserved.
        expect(body.tokens).toBe(7);
    });

    it("does not mutate the caller's LogEvent and detaches the emitted body", () => {
        logFixture = installLogFixture();
        const secretFilter = createSecretFilter({
            initialValues: ["hunter2"],
        });
        const sink = createOtelLoggerSink({ secretFilter });

        const originalNested = { greeting: "hello", token: "hunter2" };
        const originalList: (string | number)[] = [1, 2, 3];
        const eventPayload = {
            sessionId: "sess",
            nested: originalNested,
            values: originalList,
            emptyObj: {},
            emptyArr: [] as unknown[],
        };
        const event: LogEvent = {
            eventName: "immutability",
            timestamp: "2024-06-01T00:00:00.000Z",
            event: eventPayload,
        };
        const snapshot = JSON.parse(JSON.stringify(event));

        sink.logEvent(event);

        expect(event).toEqual(snapshot);
        // Reference identity preserved.
        expect(event.event.nested).toBe(originalNested);
        expect(event.event.values).toBe(originalList);
        expect(originalNested.token).toBe("hunter2");

        const record = logFixture.exporter.getFinishedLogRecords()[0]!;
        const body = record.body as Record<string, unknown>;
        // Emitted body is a fresh detached snapshot.
        expect(body).not.toBe(eventPayload);
        expect(body.nested).not.toBe(originalNested);
        expect(body.values).not.toBe(originalList);
        expect(body.emptyObj).not.toBe(eventPayload.emptyObj);
        expect(body.emptyArr).not.toBe(eventPayload.emptyArr);
        // Structural equality of untouched containers.
        expect(body.values).toEqual([1, 2, 3]);
        // The registered secret is redacted in the emitted body.
        expect((body.nested as { token: string }).token).not.toBe("hunter2");
    });

    it("detaches every reachable container when the payload has no strings anywhere", () => {
        // `redactObject` short-circuits back to the caller's own reference
        // when it finds no strings to scrub, so the sink must clone JSON
        // containers locally on that path. Exercise it with a payload that
        // is deliberately string-free at every depth.
        logFixture = installLogFixture();
        const sink = createOtelLoggerSink();

        const originalNested: Record<string, unknown> = {
            count: 1,
            flag: true,
            nullField: null,
            deeper: { level: 2, values: [10, 20] },
        };
        const originalList: unknown[] = [1, 2, 3, [4, 5]];
        const eventPayload: Record<string, unknown> = {
            count: 42,
            flag: false,
            nested: originalNested,
            values: originalList,
        };
        const event: LogEvent = {
            eventName: "no.strings",
            timestamp: "2024-06-01T00:00:00.000Z",
            event: eventPayload,
        };

        sink.logEvent(event);

        const record = logFixture.exporter.getFinishedLogRecords()[0]!;
        const body = record.body as Record<string, unknown>;
        // Root, nested object, and array are all fresh references.
        expect(body).not.toBe(eventPayload);
        expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
        expect(body.nested).not.toBe(originalNested);
        expect(body.values).not.toBe(originalList);
        const bodyNested = body.nested as Record<string, unknown>;
        expect(Object.getPrototypeOf(bodyNested)).toBe(Object.prototype);
        const originalDeeper = originalNested.deeper as Record<string, unknown>;
        expect(bodyNested.deeper).not.toBe(originalDeeper);
        expect((bodyNested.deeper as { values: unknown[] }).values).not.toBe(
            originalDeeper.values,
        );
        // Structural equality of the captured snapshot before any mutation.
        expect(body).toEqual({
            count: 42,
            flag: false,
            nested: {
                count: 1,
                flag: true,
                nullField: null,
                deeper: { level: 2, values: [10, 20] },
            },
            values: [1, 2, 3, [4, 5]],
        });

        // Mutate every level of the caller's payload after emit.
        eventPayload.count = 999;
        eventPayload.newRootKey = "added";
        originalNested.count = 100;
        (originalDeeper.values as number[]).push(30);
        originalList.push(99);

        // Captured body still reflects the pre-emit values.
        expect(body.count).toBe(42);
        expect(body).not.toHaveProperty("newRootKey");
        expect((body.nested as Record<string, unknown>).count).toBe(1);
        expect(
            (
                (body.nested as Record<string, unknown>).deeper as {
                    values: number[];
                }
            ).values,
        ).toEqual([10, 20]);
        expect(body.values).toEqual([1, 2, 3, [4, 5]]);
    });

    it("correlates the emitted record to the active span", () => {
        traceFixture = installTraceFixture();
        logFixture = installLogFixture();
        const sink = createOtelLoggerSink();
        const tracer = trace.getTracer("test");

        let expectedTraceId = "";
        let expectedSpanId = "";
        tracer.startActiveSpan("outer", (span) => {
            expectedTraceId = span.spanContext().traceId;
            expectedSpanId = span.spanContext().spanId;
            sink.logEvent(baseEvent({ event: { sessionId: "sess" } }));
            span.end();
        });

        const record = logFixture.exporter.getFinishedLogRecords()[0]!;
        expect(record.spanContext).toBeDefined();
        expect(record.spanContext!.traceId).toBe(expectedTraceId);
        expect(record.spanContext!.spanId).toBe(expectedSpanId);
    });

    it("emits no record when no logs provider is registered", () => {
        // No log fixture install: `logs.getLogger` returns a ProxyLogger
        // whose delegate is the NoopLogger.
        const sink = createOtelLoggerSink();
        expect(() => {
            sink.logEvent(baseEvent({ event: { sessionId: "s" } }));
        }).not.toThrow();
        // Nothing to inspect: NoopLogger.emit does nothing and any
        // side effect (throw) would fail the test above.
    });

    it("emits after late provider registration for a sink constructed before it", () => {
        // Construct the sink first (no provider yet).
        const sink = createOtelLoggerSink();
        sink.logEvent(baseEvent({ event: { sessionId: "before" } }));

        // Register a provider *after* the sink was created and used.
        logFixture = installLogFixture();

        sink.logEvent(baseEvent({ event: { sessionId: "after" } }));

        const records = logFixture.exporter.getFinishedLogRecords();
        expect(records).toHaveLength(1);
        const body = records[0]!.body as Record<string, unknown>;
        expect(body.sessionId).toBe("after");
    });

    it("does not inspect or snapshot the body when the logger is disabled", () => {
        let bodyReads = 0;
        let emitCalls = 0;
        logs.setGlobalLoggerProvider({
            getLogger: () => ({
                enabled: () => false,
                emit: () => {
                    emitCalls++;
                },
            }),
        } as never);
        try {
            const sink = createOtelLoggerSink();
            const event = baseEvent();
            Object.defineProperty(event, "event", {
                configurable: true,
                get() {
                    bodyReads++;
                    throw new Error("disabled logger read the event body");
                },
            });

            expect(() => sink.logEvent(event)).not.toThrow();
            expect(bodyReads).toBe(0);
            expect(emitCalls).toBe(0);
        } finally {
            logs.disable();
        }
    });

    it("isolates emit failures from a sibling sink", () => {
        // Install a stub provider whose logger throws in `emit()` so the
        // sink actually reaches its failure guard. `enabled()` returns
        // true so the sink does not short-circuit. Cannot layer this on
        // top of `installLogFixture()`: `logs.setGlobalLoggerProvider`
        // is first-writer-wins, so a second registration is silently
        // dropped and the real fixture would win.
        const brokenLogger = {
            emit(_record: OtelLogRecord): void {
                throw new Error("boom emit");
            },
            enabled(): boolean {
                return true;
            },
        };
        let emitCalls = 0;
        const brokenProvider = {
            getLogger: () => {
                return {
                    emit(record: OtelLogRecord): void {
                        emitCalls++;
                        brokenLogger.emit(record);
                    },
                    enabled: brokenLogger.enabled,
                };
            },
        };
        logs.setGlobalLoggerProvider(brokenProvider as never);
        try {
            const sibling: LoggerSink & { events: LogEvent[] } = {
                events: [],
                logEvent(event: LogEvent) {
                    this.events.push(event);
                },
            };
            const logger = new MultiSinkLogger([
                createOtelLoggerSink(),
                sibling,
            ]);

            const payload = { sessionId: "sib" };
            expect(() => logger.logEvent("test.event", payload)).not.toThrow();
            expect(emitCalls).toBe(1);
            expect(sibling.events).toHaveLength(1);
            expect(sibling.events[0]!.event).toBe(payload);
            // The original event object is untouched.
            expect(payload).toEqual({ sessionId: "sib" });
        } finally {
            logs.disable();
        }
    });

    it("emits with the SDK-defaulted timestamp when LogEvent.timestamp is invalid", () => {
        logFixture = installLogFixture();
        const sink = createOtelLoggerSink();
        const before = Date.now();

        sink.logEvent(
            baseEvent({
                timestamp: "not-a-real-timestamp",
                event: { sessionId: "s" },
            }),
        );

        const after = Date.now();
        const records = logFixture.exporter.getFinishedLogRecords();
        expect(records).toHaveLength(1);
        const record = records[0]!;
        const emittedMs = hrTimeToMs(record.hrTime);
        // Invalid timestamp is dropped; the SDK falls back to `Date.now()`.
        // Allow a small slack for the SDK's own `Date.now()` call.
        expect(emittedMs).toBeGreaterThanOrEqual(before - 10);
        expect(emittedMs).toBeLessThanOrEqual(after + 10);
    });

    it("emits with the SDK-defaulted timestamp when LogEvent.timestamp is a rolled-over ISO date", () => {
        // `2024-02-30` is not a real date. `new Date(...)` may either
        // return an Invalid Date or roll over to `2024-03-01`; either
        // way the round-trip through `toISOString()` no longer matches
        // the input, so the sink must drop the timestamp field and let
        // the SDK default `hrTime` from `Date.now()`.
        logFixture = installLogFixture();
        const sink = createOtelLoggerSink();
        const before = Date.now();

        sink.logEvent(
            baseEvent({
                timestamp: "2024-02-30T00:00:00.000Z",
                event: { sessionId: "s" },
            }),
        );

        const after = Date.now();
        const records = logFixture.exporter.getFinishedLogRecords();
        expect(records).toHaveLength(1);
        const emittedMs = hrTimeToMs(records[0]!.hrTime);
        expect(emittedMs).toBeGreaterThanOrEqual(before - 10);
        expect(emittedMs).toBeLessThanOrEqual(after + 10);
    });

    it("survives an empty timestamp string without dropping the record", () => {
        logFixture = installLogFixture();
        const sink = createOtelLoggerSink();
        sink.logEvent(
            baseEvent({
                timestamp: "",
                event: { sessionId: "s" },
            }),
        );
        expect(logFixture.exporter.getFinishedLogRecords()).toHaveLength(1);
    });

    it("survives global provider cleanup between emits", async () => {
        logFixture = installLogFixture();
        const sink = createOtelLoggerSink();

        sink.logEvent(baseEvent({ event: { sessionId: "before-clean" } }));
        expect(logFixture.exporter.getFinishedLogRecords()).toHaveLength(1);

        await disposeLogFixture(logFixture);
        logFixture = undefined;

        // After teardown the sink must not throw and must not touch any
        // still-registered provider.
        expect(() =>
            sink.logEvent(baseEvent({ event: { sessionId: "after-clean" } })),
        ).not.toThrow();

        // Re-install a provider; the same sink must resume emitting into it.
        logFixture = installLogFixture();
        sink.logEvent(baseEvent({ event: { sessionId: "after-reinstall" } }));
        const records = logFixture.exporter.getFinishedLogRecords();
        expect(records).toHaveLength(1);
        const body = records[0]!.body as Record<string, unknown>;
        expect(body.sessionId).toBe("after-reinstall");
    });

    it("records use the frozen instrumentation scope constants", () => {
        logFixture = installLogFixture();
        const sink: OtelLoggerSink = createOtelLoggerSink();
        sink.logEvent(baseEvent({ event: { sessionId: "s" } }));
        const record = logFixture.exporter.getFinishedLogRecords()[0]!;
        expect(record.instrumentationScope.name).toBe(
            INSTRUMENTATION_SCOPE_NAME,
        );
        expect(record.instrumentationScope.version).toBe(
            INSTRUMENTATION_SCOPE_VERSION,
        );
    });

    it("passes the emit-time active OTel context to the SDK", () => {
        traceFixture = installTraceFixture();

        // Capture the raw LogRecord the sink emits, without an SDK
        // provider in the way. The SDK strips `record.context` after
        // deriving `_spanContext`, so an assertion on the ReadableLogRecord
        // cannot distinguish `ROOT_CONTEXT` from the emit-time context.
        const captured: OtelLogRecord[] = [];
        const wrappingLogger = {
            emit(record: OtelLogRecord): void {
                captured.push(record);
            },
            enabled(): boolean {
                return true;
            },
        };
        logs.setGlobalLoggerProvider({
            getLogger: () => wrappingLogger,
        } as never);
        try {
            const sink = createOtelLoggerSink();
            const tracer = trace.getTracer("test");
            let expectedTraceId = "";
            let expectedSpanId = "";
            tracer.startActiveSpan("s", (span) => {
                expectedTraceId = span.spanContext().traceId;
                expectedSpanId = span.spanContext().spanId;
                sink.logEvent(baseEvent({ event: {} }));
                span.end();
            });

            expect(captured).toHaveLength(1);
            const record = captured[0]!;
            expect(record.context).toBeDefined();
            expect(record.context).not.toBe(ROOT_CONTEXT);
            const spanContext = trace.getSpanContext(record.context!);
            expect(spanContext).toBeDefined();
            expect(spanContext!.traceId).toBe(expectedTraceId);
            expect(spanContext!.spanId).toBe(expectedSpanId);
        } finally {
            logs.disable();
        }
    });

    describe("severity", () => {
        it("defaults severity to INFO when LogEvent.severity is undefined", () => {
            logFixture = installLogFixture();
            const sink = createOtelLoggerSink();
            sink.logEvent(baseEvent({ event: { sessionId: "s" } }));
            const record = logFixture.exporter.getFinishedLogRecords()[0]!;
            expect(record.severityNumber).toBe(SeverityNumber.INFO);
            expect(record.severityText).toBe("INFO");
        });

        it("passes through 'info' as OTel INFO", () => {
            logFixture = installLogFixture();
            const sink = createOtelLoggerSink();
            sink.logEvent(
                baseEvent({
                    event: { sessionId: "s" },
                    severity: "info",
                }),
            );
            const record = logFixture.exporter.getFinishedLogRecords()[0]!;
            expect(record.severityNumber).toBe(SeverityNumber.INFO);
            expect(record.severityText).toBe("INFO");
        });

        it("maps 'warning' to OTel WARN", () => {
            logFixture = installLogFixture();
            const sink = createOtelLoggerSink();
            sink.logEvent(
                baseEvent({
                    event: { sessionId: "s" },
                    severity: "warning",
                }),
            );
            const record = logFixture.exporter.getFinishedLogRecords()[0]!;
            expect(record.severityNumber).toBe(SeverityNumber.WARN);
            expect(record.severityText).toBe("WARN");
        });

        it("maps 'error' to OTel ERROR", () => {
            logFixture = installLogFixture();
            const sink = createOtelLoggerSink();
            sink.logEvent(
                baseEvent({
                    event: { sessionId: "s" },
                    severity: "error",
                }),
            );
            const record = logFixture.exporter.getFinishedLogRecords()[0]!;
            expect(record.severityNumber).toBe(SeverityNumber.ERROR);
            expect(record.severityText).toBe("ERROR");
        });

        it("never infers severity from the event name or payload", () => {
            // A payload that names or hints at 'error' must not upgrade
            // the record severity. The only signal is `LogEvent.severity`.
            logFixture = installLogFixture();
            const sink = createOtelLoggerSink();
            sink.logEvent(
                baseEvent({
                    eventName: "translation.error",
                    event: {
                        severity: "error",
                        level: "error",
                        message: "something failed",
                    },
                }),
            );
            const record = logFixture.exporter.getFinishedLogRecords()[0]!;
            expect(record.severityNumber).toBe(SeverityNumber.INFO);
            expect(record.severityText).toBe("INFO");
        });
    });

    describe("bounded body processing", () => {
        it("replaces a self-referencing subtree with a cycle marker without throwing", () => {
            logFixture = installLogFixture();
            const sink = createOtelLoggerSink();

            const payload: Record<string, unknown> = {
                sessionId: "sess",
                tag: "cycle",
            };
            // Introduce a genuine reference cycle: payload.self -> payload.
            payload.self = payload;

            expect(() =>
                sink.logEvent(
                    baseEvent({
                        event: payload as { [key: string]: unknown },
                    }),
                ),
            ).not.toThrow();

            const records = logFixture.exporter.getFinishedLogRecords();
            expect(records).toHaveLength(1);
            const body = records[0]!.body as Record<string, unknown>;
            // Non-cyclic siblings survive unchanged.
            expect(body.sessionId).toBe("sess");
            expect(body.tag).toBe("cycle");
            // The self-reference collapses to a truncation marker.
            expect(body.self).toEqual({ __typeagent_otel_truncated: "cycle" });
        });

        it("preserves cross-references that are not actual cycles", () => {
            // Two separate keys can point at the same shared inner object
            // without forming a cycle; the traversal walks the tree, so
            // both branches should be preserved without a cycle marker.
            logFixture = installLogFixture();
            const sink = createOtelLoggerSink();

            const shared = { name: "shared" };
            sink.logEvent(
                baseEvent({
                    event: {
                        a: shared,
                        b: shared,
                    },
                }),
            );

            const body = logFixture.exporter.getFinishedLogRecords()[0]!
                .body as Record<string, unknown>;
            expect(body.a).toEqual({ name: "shared" });
            expect(body.b).toEqual({ name: "shared" });
            // Neither branch is a truncation marker.
            expect(body.a).not.toHaveProperty("__typeagent_otel_truncated");
            expect(body.b).not.toHaveProperty("__typeagent_otel_truncated");
        });

        it("caps nesting depth deterministically with a 'depth' marker", () => {
            logFixture = installLogFixture();
            const sink = createOtelLoggerSink();

            // Build a chain far deeper than the sink's cap. Each `next`
            // hop is one depth level; the top-level object is depth 0.
            const chainDepth = 200;
            let deepest: { name: string } | Record<string, unknown> = {
                name: "bottom",
            };
            for (let i = 0; i < chainDepth; i++) {
                deepest = { next: deepest };
            }
            sink.logEvent(
                baseEvent({
                    event: { root: deepest } as Record<string, unknown>,
                }),
            );

            const body = logFixture.exporter.getFinishedLogRecords()[0]!.body;
            // Walk `next` and find a `__typeagent_otel_truncated: "depth"`
            // marker somewhere before the (unreachable) bottom.
            let cursor: unknown = body;
            let steps = 0;
            let sawDepthMarker = false;
            while (
                cursor !== null &&
                typeof cursor === "object" &&
                steps < chainDepth + 10
            ) {
                const rec = cursor as Record<string, unknown>;
                if (rec.__typeagent_otel_truncated === "depth") {
                    sawDepthMarker = true;
                    break;
                }
                cursor = rec.next ?? rec.root;
                steps++;
            }
            expect(sawDepthMarker).toBe(true);
        });

        it("caps approximate serialized size and preserves a partial body with a 'size' marker", () => {
            logFixture = installLogFixture();
            const sink = createOtelLoggerSink();

            // Build a payload well past the 60 KiB approximate cap:
            // ~200,000 short strings.
            const values = new Array(200_000);
            for (let i = 0; i < values.length; i++) {
                values[i] = `item-${i}`;
            }
            sink.logEvent(
                baseEvent({
                    event: { sessionId: "sess", values } as Record<
                        string,
                        unknown
                    >,
                }),
            );

            const records = logFixture.exporter.getFinishedLogRecords();
            // Whole record is preserved; only the body is truncated.
            expect(records).toHaveLength(1);
            const body = records[0]!.body as Record<string, unknown>;
            // Correlation-adjacent scalars stayed.
            expect(body.sessionId).toBe("sess");
            expect(Array.isArray(body.values)).toBe(true);
            const partial = body.values as unknown[];
            // Truncated well before the original length.
            expect(partial.length).toBeLessThan(values.length);
            // Last element is the size truncation marker.
            expect(partial[partial.length - 1]).toEqual({
                __typeagent_otel_truncated: "size",
            });
        });

        it("replaces a single oversized value instead of retaining it whole", () => {
            logFixture = installLogFixture();
            const sink = createOtelLoggerSink();
            const oversized = "x".repeat(100_000);

            sink.logEvent(
                baseEvent({
                    event: {
                        sessionId: "sess",
                        oversized,
                    },
                }),
            );

            const body = logFixture.exporter.getFinishedLogRecords()[0]!
                .body as Record<string, unknown>;
            expect(body.sessionId).toBe("sess");
            expect(body.oversized).toEqual({
                __typeagent_otel_truncated: "size",
            });
            expect(oversized).toHaveLength(100_000);
        });

        it("enforces the hard serialized UTF-8 byte limit after snapshotting", () => {
            logFixture = installLogFixture();
            const sink = createOtelLoggerSink();

            // 20,000 emoji occupy 40,000 UTF-16 code units, which fits
            // the traversal budget, but 80,000 UTF-8 bytes, which exceeds
            // the hard serialized-body limit.
            sink.logEvent(
                baseEvent({
                    event: { text: "😀".repeat(20_000) },
                }),
            );

            expect(
                logFixture.exporter.getFinishedLogRecords()[0]!.body,
            ).toEqual({
                __typeagent_otel_truncated: "size",
            });
        });

        it("does not hang on a cycle even when the payload also contains strings that trigger redaction", () => {
            logFixture = installLogFixture();
            const secretFilter = createSecretFilter({
                initialValues: ["cycle-secret"],
            });
            const sink = createOtelLoggerSink({ secretFilter });

            const payload: Record<string, unknown> = {
                sessionId: "sess",
                token: "cycle-secret",
            };
            payload.self = payload;
            expect(() =>
                sink.logEvent(
                    baseEvent({
                        event: payload as { [key: string]: unknown },
                    }),
                ),
            ).not.toThrow();

            const body = logFixture.exporter.getFinishedLogRecords()[0]!
                .body as Record<string, unknown>;
            expect(String(body.token)).not.toContain("cycle-secret");
            expect(body.self).toEqual({ __typeagent_otel_truncated: "cycle" });
        });

        it("does not mutate the caller when the body is truncated", () => {
            logFixture = installLogFixture();
            const sink = createOtelLoggerSink();

            const original: Record<string, unknown> = { sessionId: "sess" };
            original.self = original;
            const snapshot = { sessionId: "sess", self: original };
            // Sanity: identity check that the cycle is set up.
            expect((snapshot.self as Record<string, unknown>).self).toBe(
                original,
            );

            sink.logEvent(
                baseEvent({
                    event: original as { [key: string]: unknown },
                }),
            );

            // Caller's payload keeps its cycle and every field.
            expect(original.sessionId).toBe("sess");
            expect(original.self).toBe(original);
        });

        it("replaces values outside the JSON-compatible contract", () => {
            logFixture = installLogFixture();
            const sink = createOtelLoggerSink();

            sink.logEvent(
                baseEvent({
                    event: {
                        undefinedValue: undefined,
                        bigintValue: 1n,
                        nonFiniteNumber: Number.POSITIVE_INFINITY,
                        dateValue: new Date(0),
                    },
                }),
            );

            const body = logFixture.exporter.getFinishedLogRecords()[0]!
                .body as Record<string, unknown>;
            for (const key of [
                "undefinedValue",
                "bigintValue",
                "nonFiniteNumber",
                "dateValue",
            ]) {
                expect(body[key]).toEqual({
                    __typeagent_otel_truncated: "unsupported",
                });
            }
        });

        it("charges repeated unsupported markers against the size budget", () => {
            logFixture = installLogFixture();
            const sink = createOtelLoggerSink();
            const values = new Array(200_000).fill(undefined);

            sink.logEvent(
                baseEvent({
                    event: { values },
                }),
            );

            const body = logFixture.exporter.getFinishedLogRecords()[0]!
                .body as { values: unknown[] };
            expect(body.values.length).toBeLessThan(values.length);
            expect(body.values[body.values.length - 1]).toEqual({
                __typeagent_otel_truncated: "size",
            });
        });
    });
});

function hrTimeToMs(hrTime: ReadableLogRecord["hrTime"]): number {
    const [seconds, nanos] = hrTime;
    return seconds * 1_000 + nanos / 1_000_000;
}
