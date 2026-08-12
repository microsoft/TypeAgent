// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { context, SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { otel } from "@typeagent/telemetry";
import {
    createInMemorySpanManager,
    type CapturedSpan,
    type InMemorySpanManager,
} from "@typeagent/telemetry/testing/inMemorySpanManager";
import { wrapActionSpan } from "../src/otel/actionSpan.js";
import { wrapReasoningSpan } from "../src/otel/reasoningSpan.js";
import { wrapRootRequestSpan } from "../src/otel/rootRequestSpan.js";
import { wrapTranslationSpan } from "../src/otel/translationSpan.js";

const ATTRIBUTES = {
    sessionId: "session-e2e",
    activationId: "activation-e2e",
    traceId: "legacy-trace-e2e",
};

function getOnlySpan(manager: InMemorySpanManager, name: string): CapturedSpan {
    const spans = manager.findSpansByName(name);
    if (spans.length !== 1) {
        throw new Error(`Expected one ${name} span, got ${spans.length}`);
    }
    return spans[0]!;
}

async function runRepresentativeLlmCall(body: (span: Span) => void) {
    const tracer = trace.getTracer(
        otel.INSTRUMENTATION_SCOPE_NAME,
        otel.INSTRUMENTATION_SCOPE_VERSION,
    );
    return tracer.startActiveSpan(
        otel.TYPEAGENT_SPAN_NAMES.LLM,
        async (span) => {
            otel.setTypeAgentSpanAttributes(span, {
                genAiSystem: "test",
                genAiRequestModel: "test-model",
            });
            try {
                body(span);
                return "model response";
            } finally {
                span.end();
            }
        },
    );
}

describe("one-process OTel request trace", () => {
    let manager: InMemorySpanManager;

    beforeEach(() => {
        manager = createInMemorySpanManager();
    });

    afterEach(async () => {
        await manager.shutdown();
    });

    it("forms one coherent successful trace under a provider installed by the host", async () => {
        const hostTracer = trace.getTracer("embedding-host");

        await hostTracer.startActiveSpan("host.request", async (hostSpan) => {
            await wrapRootRequestSpan(
                ATTRIBUTES,
                async () => {
                    await wrapTranslationSpan(ATTRIBUTES, async () => {
                        await runRepresentativeLlmCall(() => undefined);
                    });
                    await wrapReasoningSpan(ATTRIBUTES, async () => {
                        await runRepresentativeLlmCall(() => undefined);
                        await wrapActionSpan(
                            {
                                ...ATTRIBUTES,
                                agentName: "test",
                                actionName: "act",
                            },
                            async () => undefined,
                        );
                    });
                    return {};
                },
                { parentContext: context.active() },
            );
            hostSpan.end();
        });

        const hostSpan = getOnlySpan(manager, "host.request");
        const requestSpan = getOnlySpan(manager, "typeagent.request");
        const translationSpan = getOnlySpan(manager, "typeagent.translation");
        const reasoningSpan = getOnlySpan(manager, "typeagent.reasoning");
        const actionSpan = getOnlySpan(manager, "typeagent.action");
        const llmSpans = manager.findSpansByName("typeagent.llm");

        expect(llmSpans).toHaveLength(2);
        manager.assertParentChild(hostSpan, requestSpan);
        manager.assertParentChild(requestSpan, translationSpan);
        manager.assertParentChild(translationSpan, llmSpans[0]!);
        manager.assertParentChild(requestSpan, reasoningSpan);
        manager.assertParentChild(reasoningSpan, llmSpans[1]!);
        manager.assertParentChild(reasoningSpan, actionSpan);

        const requestTraceId = requestSpan.spanContext().traceId;
        expect(
            manager
                .getFinishedSpans()
                .every((span) => span.spanContext().traceId === requestTraceId),
        ).toBe(true);
        for (const span of manager.getFinishedSpans()) {
            expect(span.status.code).toBe(SpanStatusCode.UNSET);
        }
    });
});

describe("OTel instrumentation without a provider", () => {
    beforeEach(() => {
        trace.disable();
        context.disable();
    });

    it("preserves normal operation and error propagation as a safe no-op", async () => {
        await expect(
            wrapRootRequestSpan(ATTRIBUTES, async () => {
                await wrapTranslationSpan(ATTRIBUTES, async () => undefined);
                await wrapReasoningSpan(ATTRIBUTES, async () => {
                    await runRepresentativeLlmCall(() => undefined);
                    await wrapActionSpan(ATTRIBUTES, async () => undefined);
                });
                return { cancelled: false };
            }),
        ).resolves.toEqual({ cancelled: false });

        const failure = new Error("expected failure");
        await expect(
            wrapActionSpan(ATTRIBUTES, async () => {
                throw failure;
            }),
        ).rejects.toBe(failure);
    });
});
