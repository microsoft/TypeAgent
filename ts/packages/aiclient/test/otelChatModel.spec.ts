// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { context } from "@opentelemetry/api";
import {
    createInMemorySpanManager,
    type InMemorySpanManager,
} from "@typeagent/telemetry/testing/inMemorySpanManager";
import { otel } from "@typeagent/telemetry";
import type { Logger } from "@typeagent/telemetry";
import { error, success } from "typechat";
import type { ChatModelWithStreaming } from "../src/models.js";
import {
    instrumentChatModel,
    resetLlmClassificationDiagnostics,
} from "../src/otelChatModel.js";
import { fetchWithRetry } from "../src/restClient.js";
import { withChatModelTelemetryContext } from "../src/chatModelTelemetryContext.js";

type CapturedEvent = { name: string; data: Record<string, unknown> };

function createCapturingLogger(events: CapturedEvent[]): Logger {
    return {
        logEvent(name, data) {
            events.push({ name, data });
        },
    };
}

function createModel(): ChatModelWithStreaming {
    return {
        completionSettings: {},
        async complete(_prompt, usageCallback) {
            usageCallback?.({
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
            });
            return success("done");
        },
        async completeStream(_prompt, usageCallback) {
            async function* stream() {
                yield "one";
                usageCallback?.({
                    prompt_tokens: 4,
                    completion_tokens: 2,
                    total_tokens: 6,
                });
                yield "two";
            }
            return success(stream());
        },
    };
}

describe("instrumentChatModel", () => {
    let spans: InMemorySpanManager;

    beforeEach(() => {
        spans = createInMemorySpanManager();
        otel.setStructuredLoggingEnabled(false);
        resetLlmClassificationDiagnostics();
    });

    afterEach(async () => {
        otel.setStructuredLoggingEnabled(false);
        resetLlmClassificationDiagnostics();
        await spans.shutdown();
    });

    it("records successful complete calls as typeagent.llm spans", async () => {
        const model = instrumentChatModel(createModel(), {
            provider: "test-provider",
            model: "test-model",
        });

        await expect(model.complete("private prompt")).resolves.toEqual(
            success("done"),
        );

        const span = spans.findSpansByName("typeagent.llm")[0];
        expect(span?.attributes).toMatchObject({
            "gen_ai.system": "test-provider",
            "gen_ai.request.model": "test-model",
            "typeagent.llm.phase": "unknown",
            "typeagent.llm.purpose": "unknown",
            "typeagent.llm.scope": "foreground",
            "typeagent.llm.classification_source": "default",
        });
        expect(span?.status.code).toBe(0);
    });

    it("keeps streaming spans open until the iterator completes", async () => {
        const model = instrumentChatModel(createModel(), {
            provider: "test-provider",
        });

        const result = await model.completeStream("private prompt");
        expect(result.success).toBe(true);
        expect(spans.findSpansByName("typeagent.llm")).toHaveLength(0);
        if (!result.success) {
            return;
        }

        const chunks: string[] = [];
        for await (const chunk of result.data) {
            chunks.push(chunk);
        }

        expect(chunks).toEqual(["one", "two"]);
        expect(spans.findSpansByName("typeagent.llm")).toHaveLength(1);
    });

    it("marks returned model failures as failed spans", async () => {
        const base = createModel();
        base.complete = async () => error("private provider error");
        const model = instrumentChatModel(base, {
            provider: "test-provider",
        });

        const result = await model.complete("private prompt");

        expect(result.success).toBe(false);
        expect(spans.findSpansByName("typeagent.llm")[0]?.status.code).toBe(2);
    });

    it("supports callers that capture and replace complete", async () => {
        const model = instrumentChatModel(createModel(), {
            provider: "test-provider",
        });
        const instrumentedComplete = model.complete;
        model.complete = async (...args) => instrumentedComplete(...args);

        await expect(model.complete("private prompt")).resolves.toEqual(
            success("done"),
        );

        expect(spans.findSpansByName("typeagent.llm")).toHaveLength(1);
    });

    it("marks streams that end after abort as cancelled", async () => {
        const model = instrumentChatModel(createModel(), {
            provider: "test-provider",
        });
        const controller = new AbortController();
        const result = await model.completeStream(
            "private prompt",
            undefined,
            undefined,
            undefined,
            controller.signal,
        );
        expect(result.success).toBe(true);
        if (!result.success) {
            return;
        }

        controller.abort();
        for await (const _chunk of result.data) {
            // Consume the provider stream so its normal completion is observed.
        }

        expect(spans.findSpansByName("typeagent.llm")[0]?.status).toMatchObject(
            {
                code: 2,
                message: "cancelled",
            },
        );
    });

    it("gates lifecycle logs and preserves inherited correlation", async () => {
        const events: CapturedEvent[] = [];
        const logger = createCapturingLogger(events);

        await instrumentChatModel(
            createModel(),
            {
                provider: "disabled-provider",
            },
            logger,
        ).complete("private prompt");
        expect(events).toHaveLength(0);

        otel.setStructuredLoggingEnabled(true);
        const activeContext = otel.setActiveTypeAgentSpanAttributes(
            context.active(),
            {
                sessionId: "session",
                activationId: "activation",
                requestId: "request",
                traceId: "legacy-trace",
            },
        );
        await context.with(activeContext, () =>
            instrumentChatModel(
                createModel(),
                {
                    provider: "enabled-provider",
                },
                logger,
            ).complete("private prompt"),
        );

        expect(
            events.filter(
                ({ name }) =>
                    name === "llm:started" || name === "llm:completed",
            ),
        ).toEqual([
            {
                name: "llm:started",
                data: expect.objectContaining({
                    sessionId: "session",
                    activationId: "activation",
                    requestId: "request",
                    traceId: "legacy-trace",
                }),
            },
            {
                name: "llm:completed",
                data: expect.objectContaining({
                    sessionId: "session",
                    activationId: "activation",
                    requestId: "request",
                    traceId: "legacy-trace",
                }),
            },
        ]);
    });

    it("records explicit lifecycle classification on spans and events", async () => {
        otel.setStructuredLoggingEnabled(true);
        const events: CapturedEvent[] = [];
        const model = instrumentChatModel(
            createModel(),
            { provider: "test-provider" },
            createCapturingLogger(events),
        );

        await withChatModelTelemetryContext(
            {
                phase: "background",
                purpose: "cache-generation",
                scope: "background",
            },
            () => model.complete("private prompt"),
        );

        expect(
            spans.findSpansByName("typeagent.llm")[0]?.attributes,
        ).toMatchObject({
            "typeagent.llm.phase": "background",
            "typeagent.llm.purpose": "cache-generation",
            "typeagent.llm.scope": "background",
            "typeagent.llm.classification_source": "explicit",
        });
        expect(events.map(({ name, data }) => ({ name, data }))).toEqual([
            {
                name: "llm:started",
                data: expect.objectContaining({
                    phase: "background",
                    purpose: "cache-generation",
                    scope: "background",
                    classificationSource: "explicit",
                }),
            },
            {
                name: "llm:completed",
                data: expect.objectContaining({
                    phase: "background",
                    purpose: "cache-generation",
                    scope: "background",
                    classificationSource: "explicit",
                }),
            },
        ]);
    });

    describe("classification source", () => {
        it("reports default when no call site classified the call", async () => {
            otel.setStructuredLoggingEnabled(true);
            const events: CapturedEvent[] = [];
            await instrumentChatModel(
                createModel(),
                { provider: "test-provider" },
                createCapturingLogger(events),
            ).complete("private prompt");

            const lifecycle = events.filter(
                ({ name }) =>
                    name === "llm:started" || name === "llm:completed",
            );
            expect(
                lifecycle.map(({ name, data }) => [
                    name,
                    data.phase,
                    data.purpose,
                    data.scope,
                    data.classificationSource,
                ]),
            ).toEqual([
                ["llm:started", "unknown", "unknown", "foreground", "default"],
                [
                    "llm:completed",
                    "unknown",
                    "unknown",
                    "foreground",
                    "default",
                ],
            ]);
        });

        it("keeps an explicit context across awaits and microtasks", async () => {
            otel.setStructuredLoggingEnabled(true);
            const events: CapturedEvent[] = [];
            const model = instrumentChatModel(
                createModel(),
                { provider: "test-provider" },
                createCapturingLogger(events),
            );

            await withChatModelTelemetryContext(
                { phase: "translation", purpose: "schema-selection" },
                async () => {
                    await Promise.resolve();
                    await new Promise<void>((resolve) =>
                        queueMicrotask(resolve),
                    );
                    return model.complete("private prompt");
                },
            );

            expect(
                events.map(({ data }) => [
                    data.phase,
                    data.purpose,
                    data.classificationSource,
                ]),
            ).toEqual([
                ["translation", "schema-selection", "explicit"],
                ["translation", "schema-selection", "explicit"],
            ]);
        });

        it("lets an inner wrapper refine purpose without restating phase", async () => {
            otel.setStructuredLoggingEnabled(true);
            const events: CapturedEvent[] = [];
            const model = instrumentChatModel(
                createModel(),
                { provider: "test-provider" },
                createCapturingLogger(events),
            );

            await withChatModelTelemetryContext(
                { phase: "action", purpose: "action", scope: "foreground" },
                () =>
                    withChatModelTelemetryContext(
                        { purpose: "capability-description" },
                        () => model.complete("private prompt"),
                    ),
            );

            expect(events[0]?.data).toMatchObject({
                phase: "action",
                purpose: "capability-description",
                scope: "foreground",
                classificationSource: "explicit",
            });
        });

        it("does not classify a call made outside the wrapper's context", async () => {
            otel.setStructuredLoggingEnabled(true);
            const events: CapturedEvent[] = [];
            const model = instrumentChatModel(
                createModel(),
                { provider: "test-provider" },
                createCapturingLogger(events),
            );

            // A detached continuation: the promise is created inside the
            // wrapper but the model call happens after it has returned.
            let release = () => {};
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            const detached = withChatModelTelemetryContext(
                { phase: "background", scope: "background" },
                () => gate,
            ).then(() => model.complete("private prompt"));
            release();
            await detached;

            expect(events[0]?.data).toMatchObject({
                phase: "unknown",
                scope: "foreground",
                classificationSource: "default",
            });
        });
    });

    describe("foreground default ratchet", () => {
        it("reports once per window and counts the calls it suppressed", async () => {
            // The ratchet keys off wall-clock time, so the clock is stubbed
            // directly rather than waiting out a real window.
            const realNow = Date.now;
            let now = realNow();
            Date.now = () => now;
            try {
                otel.setStructuredLoggingEnabled(true);
                const events: CapturedEvent[] = [];
                const model = instrumentChatModel(
                    createModel(),
                    { provider: "test-provider" },
                    createCapturingLogger(events),
                );

                for (let index = 0; index < 5; index++) {
                    await model.complete("private prompt");
                }

                const diagnostics = () =>
                    events.filter(
                        ({ name }) => name === "llm:classification:default",
                    );
                expect(diagnostics()).toHaveLength(1);
                expect(diagnostics()[0]?.data).toEqual({
                    scope: "foreground",
                    count: 1,
                    windowMs: expect.any(Number),
                });

                // Nothing more is reported until the window closes, however
                // many unclassified calls arrive.
                const windowMs = diagnostics()[0]?.data.windowMs as number;
                now += windowMs - 1;
                await model.complete("private prompt");
                expect(diagnostics()).toHaveLength(1);

                // The next window reports every call the closed one covered.
                now += 2;
                await model.complete("private prompt");
                expect(diagnostics()).toHaveLength(2);
                expect(diagnostics()[1]?.data).toMatchObject({ count: 6 });
            } finally {
                Date.now = realNow;
            }
        });

        it("stays silent for classified and for background calls", async () => {
            otel.setStructuredLoggingEnabled(true);
            const events: CapturedEvent[] = [];
            const model = instrumentChatModel(
                createModel(),
                { provider: "test-provider" },
                createCapturingLogger(events),
            );

            await withChatModelTelemetryContext(
                { phase: "translation", purpose: "action-generation" },
                () => model.complete("private prompt"),
            );
            await withChatModelTelemetryContext({ scope: "background" }, () =>
                model.complete("private prompt"),
            );

            expect(
                events.some(
                    ({ name }) => name === "llm:classification:default",
                ),
            ).toBe(false);
        });

        it("carries no prompt, model, or call-site identity", async () => {
            otel.setStructuredLoggingEnabled(true);
            const events: CapturedEvent[] = [];
            await instrumentChatModel(
                createModel(),
                { provider: "secret-provider", model: "secret-model" },
                createCapturingLogger(events),
            ).complete("private prompt");

            const diagnostic = events.find(
                ({ name }) => name === "llm:classification:default",
            );
            expect(Object.keys(diagnostic?.data ?? {}).sort()).toEqual([
                "count",
                "scope",
                "windowMs",
            ]);
            expect(JSON.stringify(diagnostic)).not.toContain("secret");
            expect(JSON.stringify(diagnostic)).not.toContain("private prompt");
        });

        it("does not fail the model call when the logger throws", async () => {
            otel.setStructuredLoggingEnabled(true);
            const throwingLogger: Logger = {
                logEvent(name) {
                    if (name === "llm:classification:default") {
                        throw new Error("sink is broken");
                    }
                },
            };

            await expect(
                instrumentChatModel(
                    createModel(),
                    { provider: "test-provider" },
                    throwingLogger,
                ).complete("private prompt"),
            ).resolves.toEqual(success("done"));
        });
    });

    // The classification and the correlation attributes ride on storage the
    // packages own, not on the OTel context, so a logs-only process (structured
    // logs on, no tracing and therefore no global context manager) keeps both.
    describe("logs-only process", () => {
        beforeEach(async () => {
            await spans.shutdown();
            otel.setStructuredLoggingEnabled(true);
        });

        it("keeps an explicit classification with no OTel context manager", async () => {
            const events: CapturedEvent[] = [];
            const model = instrumentChatModel(
                createModel(),
                { provider: "test-provider" },
                createCapturingLogger(events),
            );

            await withChatModelTelemetryContext(
                {
                    phase: "background",
                    purpose: "cache-generation",
                    scope: "background",
                },
                async () => {
                    await Promise.resolve();
                    return model.complete("private prompt");
                },
            );

            expect(events[0]?.data).toMatchObject({
                phase: "background",
                purpose: "cache-generation",
                scope: "background",
                classificationSource: "explicit",
            });
            expect(
                events.some(
                    ({ name }) => name === "llm:classification:default",
                ),
            ).toBe(false);
        });

        it("keeps active correlation with no OTel context manager", async () => {
            const events: CapturedEvent[] = [];
            const model = instrumentChatModel(
                createModel(),
                { provider: "test-provider" },
                createCapturingLogger(events),
            );

            await otel.runInTypeAgentTelemetryContext(
                context.active(),
                { sessionId: "session", requestId: "request" },
                async () => {
                    await Promise.resolve();
                    return model.complete("private prompt");
                },
            );

            expect(events[0]?.data).toMatchObject({
                sessionId: "session",
                requestId: "request",
            });
        });

        it("still reports a genuinely unattributed foreground call", async () => {
            const events: CapturedEvent[] = [];
            await instrumentChatModel(
                createModel(),
                { provider: "test-provider" },
                createCapturingLogger(events),
            ).complete("private prompt");

            expect(events[0]?.data).toMatchObject({
                classificationSource: "default",
            });
            expect(
                events.filter(
                    ({ name }) => name === "llm:classification:default",
                ),
            ).toHaveLength(1);
        });
    });

    describe("failure classification", () => {
        it("classifies a thrown provider error without its message", async () => {
            otel.setStructuredLoggingEnabled(true);
            const events: CapturedEvent[] = [];
            const base = createModel();
            base.complete = async () => {
                throw Object.assign(new Error("secret provider detail"), {
                    status: 429,
                });
            };

            await expect(
                instrumentChatModel(
                    base,
                    { provider: "test-provider" },
                    createCapturingLogger(events),
                ).complete("private prompt"),
            ).rejects.toThrow("secret provider detail");

            const completed = events.find(
                ({ name }) => name === "llm:completed",
            );
            expect(completed?.data).toMatchObject({
                status: "failed",
                errorCategory: "rate_limit",
                httpStatus: 429,
                retryable: true,
            });
            expect(JSON.stringify(completed)).not.toContain("secret");
        });

        it("classifies a returned failure result as a provider failure", async () => {
            otel.setStructuredLoggingEnabled(true);
            const events: CapturedEvent[] = [];
            const base = createModel();
            base.complete = async () => error("secret provider detail");

            await instrumentChatModel(
                base,
                { provider: "test-provider" },
                createCapturingLogger(events),
            ).complete("private prompt");

            const completed = events.find(
                ({ name }) => name === "llm:completed",
            );
            expect(completed?.data).toMatchObject({
                status: "failed",
                errorCategory: "provider",
            });
            expect(JSON.stringify(completed)).not.toContain("secret");
        });

        it("leaves a cancellation unclassified", async () => {
            otel.setStructuredLoggingEnabled(true);
            const events: CapturedEvent[] = [];
            const base = createModel();
            base.complete = async () => {
                throw new DOMException(
                    "The operation was aborted.",
                    "AbortError",
                );
            };

            await expect(
                instrumentChatModel(
                    base,
                    { provider: "test-provider" },
                    createCapturingLogger(events),
                ).complete("private prompt"),
            ).rejects.toThrow();

            const completed = events.find(
                ({ name }) => name === "llm:completed",
            );
            expect(completed?.data).toMatchObject({ status: "cancelled" });
            expect(completed?.data.errorCategory).toBeUndefined();
        });

        it("treats a wrapped cancellation as cancelled on every signal", async () => {
            otel.setStructuredLoggingEnabled(true);
            const events: CapturedEvent[] = [];
            const base = createModel();
            base.complete = async () => {
                throw Object.assign(new Error("translation failed"), {
                    cause: new DOMException(
                        "The operation was aborted.",
                        "AbortError",
                    ),
                });
            };

            await expect(
                instrumentChatModel(
                    base,
                    { provider: "test-provider" },
                    createCapturingLogger(events),
                ).complete("private prompt"),
            ).rejects.toThrow();

            const completed = events.find(
                ({ name }) => name === "llm:completed",
            );
            // The span status, the event status, the severity, and the absence
            // of classification fields all follow the same classification.
            expect(completed?.data).toMatchObject({
                status: "cancelled",
                success: false,
            });
            expect(completed?.data.errorCategory).toBeUndefined();
            expect(
                spans.findSpansByName("typeagent.llm")[0]?.status,
            ).toMatchObject({ code: 2, message: "cancelled" });
        });

        it("reports the classification the transport attached to a failure result", async () => {
            otel.setStructuredLoggingEnabled(true);
            const events: CapturedEvent[] = [];
            const base = createModel();
            base.complete = async () =>
                otel.attachTelemetryErrorClassification(
                    error("429: Too Many Requests: secret tenant detail"),
                    {
                        errorCategory: "rate_limit",
                        httpStatus: 429,
                        retryable: true,
                    },
                );

            await instrumentChatModel(
                base,
                { provider: "test-provider" },
                createCapturingLogger(events),
            ).complete("private prompt");

            const completed = events.find(
                ({ name }) => name === "llm:completed",
            );
            expect(completed?.data).toMatchObject({
                status: "failed",
                errorCategory: "rate_limit",
                httpStatus: 429,
                retryable: true,
            });
            expect(JSON.stringify(completed)).not.toContain("secret");
        });

        it("ignores a forged classification carrier on a failure result", async () => {
            otel.setStructuredLoggingEnabled(true);
            const events: CapturedEvent[] = [];
            const base = createModel();
            base.complete = async () =>
                otel.attachTelemetryErrorClassification(error("failed"), {
                    errorCategory: "not-a-category",
                    errorCode: "tenant-8f14e45f",
                    httpStatus: 200,
                } as unknown as otel.TelemetryErrorClassification);
            await instrumentChatModel(
                base,
                { provider: "test-provider" },
                createCapturingLogger(events),
            ).complete("private prompt");

            const completed = events.find(
                ({ name }) => name === "llm:completed",
            );
            // An unusable carrier falls back to the honest default rather than
            // exporting whatever it happened to contain.
            expect(completed?.data).toMatchObject({
                status: "failed",
                errorCategory: "provider",
            });
            expect(completed?.data.errorCode).toBeUndefined();
            expect(completed?.data.httpStatus).toBeUndefined();
        });

        it("reports provider for a real transport failure nothing recognized", async () => {
            // End to end with the actual REST client rather than a hand-built
            // `Result`: an unexplained `fetch failed` has no signal the
            // transport could attach, so the wrapper's `provider` fallback has
            // to survive. If the transport ever attached `internal` for the
            // unrecognized case, this reads `internal` instead - and every
            // unexplained provider outage would be counted as our own bug.
            otel.setStructuredLoggingEnabled(true);
            const events: CapturedEvent[] = [];
            const originalFetch = globalThis.fetch;
            (globalThis as any).fetch = async () => {
                throw new TypeError("fetch failed");
            };
            let transportFailure;
            try {
                transportFailure = await fetchWithRetry(
                    "https://example.test/openai/deployments/foo/chat/completions",
                );
            } finally {
                globalThis.fetch = originalFetch;
            }
            if (transportFailure.success) {
                throw new Error("expected the transport call to fail");
            }

            const base = createModel();
            base.complete = async () => transportFailure;

            await instrumentChatModel(
                base,
                { provider: "test-provider" },
                createCapturingLogger(events),
            ).complete("private prompt");

            expect(
                events.find(({ name }) => name === "llm:completed")?.data,
            ).toMatchObject({ status: "failed", errorCategory: "provider" });
        });

        it("ends the span and rethrows even when the completion log throws", async () => {
            otel.setStructuredLoggingEnabled(true);
            const brokenLogger: Logger = {
                logEvent(name) {
                    if (name === "llm:completed") {
                        throw new Error("sink is broken");
                    }
                },
            };
            const base = createModel();
            base.complete = async () => {
                throw new Error("provider blew up");
            };

            await expect(
                instrumentChatModel(
                    base,
                    { provider: "test-provider" },
                    brokenLogger,
                ).complete("private prompt"),
            ).rejects.toThrow("provider blew up");

            // A broken sink must not leak an unfinished span or replace the
            // original failure with a telemetry one.
            expect(spans.findSpansByName("typeagent.llm")).toHaveLength(1);
        });

        it("still ends the span when classification is fed a hostile error", async () => {
            otel.setStructuredLoggingEnabled(true);
            const events: CapturedEvent[] = [];
            const base = createModel();
            const hostile = new Proxy(new Error("hostile"), {
                get(_target, property) {
                    throw new Error(`no reads allowed: ${String(property)}`);
                },
            });
            base.complete = async () => {
                throw hostile;
            };

            let thrown: unknown;
            try {
                await instrumentChatModel(
                    base,
                    { provider: "test-provider" },
                    createCapturingLogger(events),
                ).complete("private prompt");
            } catch (caught) {
                thrown = caught;
            }

            // The original throw reaches the caller untouched, and the span is
            // still closed.
            expect(thrown).toBe(hostile);
            expect(spans.findSpansByName("typeagent.llm")).toHaveLength(1);
            expect(
                events.find(({ name }) => name === "llm:completed")?.data,
            ).toMatchObject({ status: "failed", errorCategory: "internal" });
        });
    });
});
