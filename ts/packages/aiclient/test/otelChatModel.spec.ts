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
import { instrumentChatModel } from "../src/otelChatModel.js";
import { fetchWithRetry } from "../src/restClient.js";
import {
    withChatModelTelemetryContext,
    withChatModelTelemetryPurpose,
} from "../src/chatModelTelemetryContext.js";

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
    });

    afterEach(async () => {
        otel.setStructuredLoggingEnabled(false);
        await spans.shutdown();
    });

    it("marks calls outside a classified operation as unclassified", async () => {
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
            "typeagent.llm.phase": "unclassified",
            "typeagent.llm.purpose": "unclassified",
            "typeagent.llm.scope": "unclassified",
        });
        expect(span?.events).toEqual([
            expect.objectContaining({
                name: "typeagent.llm.classification.missing",
            }),
        ]);
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

        expect(events).toEqual([
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
                phase: "explanation",
                purpose: "cache-generation",
                scope: "background",
            },
            () => model.complete("private prompt"),
        );

        expect(
            spans.findSpansByName("typeagent.llm")[0]?.attributes,
        ).toMatchObject({
            "typeagent.llm.phase": "explanation",
            "typeagent.llm.purpose": "cache-generation",
            "typeagent.llm.scope": "background",
        });
        expect(events.map(({ data }) => data)).toEqual([
            expect.objectContaining({
                phase: "explanation",
                purpose: "cache-generation",
                scope: "background",
            }),
            expect.objectContaining({
                phase: "explanation",
                purpose: "cache-generation",
                scope: "background",
            }),
        ]);
    });

    it("overrides only the purpose inside a classified operation", async () => {
        const model = instrumentChatModel(createModel(), {
            provider: "test-provider",
        });

        await withChatModelTelemetryContext(
            {
                phase: "translation",
                purpose: "action-generation",
                scope: "foreground",
            },
            () =>
                withChatModelTelemetryPurpose("schema-selection", () =>
                    model.complete("private prompt"),
                ),
        );

        expect(
            spans.findSpansByName("typeagent.llm")[0]?.attributes,
        ).toMatchObject({
            "typeagent.llm.phase": "translation",
            "typeagent.llm.purpose": "schema-selection",
            "typeagent.llm.scope": "foreground",
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
            // An unusable carrier falls back to the default rather than
            // exporting whatever it contained.
            expect(completed?.data).toMatchObject({
                status: "failed",
                errorCategory: "provider",
            });
            expect(completed?.data.errorCode).toBeUndefined();
            expect(completed?.data.httpStatus).toBeUndefined();
        });

        it("reports provider for a real transport failure nothing recognized", async () => {
            // End to end with the real REST client: an unexplained
            // `fetch failed` has no signal to attach, so the wrapper's
            // `provider` fallback must survive rather than reading `internal`.
            otel.setStructuredLoggingEnabled(true);
            const events: CapturedEvent[] = [];
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => {
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

            // A broken sink must not leak an unfinished span.
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
