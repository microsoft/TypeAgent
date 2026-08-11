// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { ActionContext } from "@typeagent/agent-sdk";
import {
    createInMemorySpanManager,
    type CapturedSpan,
    type InMemorySpanManager,
} from "@typeagent/telemetry/testing/inMemorySpanManager";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";
import { wrapActionSpan } from "../src/otel/actionSpan.js";
import {
    emitReasoningToolCall,
    REASONING_TOOL_CALL_NUMBER_CAP,
    runInReasoningSpan,
    wrapReasoningSpan,
} from "../src/otel/reasoningSpan.js";
import { wrapRootRequestSpan } from "../src/otel/rootRequestSpan.js";

const ATTRIBUTES = {
    sessionId: "session-abc",
    activationId: "activation-123",
    traceId: "trace-xyz",
};

function getOnlySpan(manager: InMemorySpanManager, name: string): CapturedSpan {
    const spans = manager.findSpansByName(name);
    if (spans.length !== 1) {
        throw new Error(`Expected one ${name} span, got ${spans.length}`);
    }
    return spans[0]!;
}

describe("wrapReasoningSpan", () => {
    let manager: InMemorySpanManager;

    beforeEach(() => {
        manager = createInMemorySpanManager();
    });

    afterEach(async () => {
        await manager.shutdown();
    });

    it("creates one reasoning span with correlation attributes", async () => {
        await wrapReasoningSpan(ATTRIBUTES, async () => undefined);

        const span = getOnlySpan(manager, "typeagent.reasoning");
        expect(span.attributes["typeagent.session.id"]).toBe("session-abc");
        expect(span.attributes["typeagent.activation.id"]).toBe(
            "activation-123",
        );
        expect(span.attributes["typeagent.trace.id"]).toBe("trace-xyz");
        expect(span.status.code).toBe(SpanStatusCode.UNSET);
    });

    it("builds production correlation attributes from dispatcher context", async () => {
        const context = {
            sessionContext: {
                agentContext: {
                    session: {
                        sessionDirPath:
                            "C:\\sessions\\reasoning-correlation-test",
                    },
                    activationId: "activation-production",
                    traceId: "trace-production",
                    telemetryOptions: {},
                },
            },
        } as unknown as ActionContext<CommandHandlerContext>;

        await runInReasoningSpan(context, async () => undefined, {
            genAiSystem: "github_copilot",
            genAiRequestModel: "claude-opus-4.8",
        });

        const span = getOnlySpan(manager, "typeagent.reasoning");
        expect(span.attributes["typeagent.session.id"]).toBe(
            "reasoning-correlation-test",
        );
        expect(span.attributes["typeagent.activation.id"]).toBe(
            "activation-production",
        );
        expect(span.attributes["typeagent.trace.id"]).toBe("trace-production");
        expect(span.attributes["gen_ai.system"]).toBe("github_copilot");
        expect(span.attributes["gen_ai.request.model"]).toBe("claude-opus-4.8");
    });

    it("creates a child of the active request span", async () => {
        await wrapRootRequestSpan(ATTRIBUTES, async () => {
            await wrapReasoningSpan(ATTRIBUTES, async () => undefined);
            return {};
        });

        manager.assertParentChild(
            getOnlySpan(manager, "typeagent.request"),
            getOnlySpan(manager, "typeagent.reasoning"),
        );
    });

    it("creates a child of an action that invokes reasoning", async () => {
        await wrapActionSpan(
            { agentName: "dispatcher", actionName: "reason" },
            async () => {
                await wrapReasoningSpan(ATTRIBUTES, async () => undefined);
            },
        );

        manager.assertParentChild(
            getOnlySpan(manager, "typeagent.action"),
            getOnlySpan(manager, "typeagent.reasoning"),
        );
    });

    it("keeps the reasoning span active through asynchronous work", async () => {
        let activeSpanId: string | undefined;

        await wrapReasoningSpan(ATTRIBUTES, async () => {
            await Promise.resolve();
            activeSpanId = trace.getActiveSpan()?.spanContext().spanId;
        });

        expect(activeSpanId).toBe(
            getOnlySpan(manager, "typeagent.reasoning").spanContext().spanId,
        );
    });

    it("records bounded tool-call numbers", async () => {
        await wrapReasoningSpan(ATTRIBUTES, async () => {
            emitReasoningToolCall(1);
            emitReasoningToolCall(REASONING_TOOL_CALL_NUMBER_CAP + 1);
            emitReasoningToolCall(REASONING_TOOL_CALL_NUMBER_CAP + 2);
        });

        const events = getOnlySpan(manager, "typeagent.reasoning").events;
        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({
            name: "reasoning.tool_call",
            attributes: { tool_call_number: 1 },
        });
        expect(events[1]).toMatchObject({
            name: "reasoning.tool_call.overflow",
            attributes: {},
        });
    });

    it("ignores tool-call events after the reasoning span has ended", async () => {
        let releaseDetached!: () => void;
        const gate = new Promise<void>((resolve) => {
            releaseDetached = resolve;
        });
        let detachedWork!: Promise<void>;

        await wrapReasoningSpan(ATTRIBUTES, async () => {
            detachedWork = (async () => {
                await gate;
                emitReasoningToolCall(1);
            })();
        });

        releaseDetached();
        await detachedWork;

        expect(getOnlySpan(manager, "typeagent.reasoning").events).toHaveLength(
            0,
        );
    });

    it("uses privacy-safe exception details by default", async () => {
        const error = new Error(
            "private reasoning prompt sk-secret12345678901234567890",
        );

        await expect(
            wrapReasoningSpan(ATTRIBUTES, async () => {
                throw error;
            }),
        ).rejects.toBe(error);

        const span = getOnlySpan(manager, "typeagent.reasoning");
        expect(span.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "reasoning failed",
        });
        const exception = span.events.find(
            (event) => event.name === "exception",
        );
        expect(exception?.attributes?.["exception.type"]).toBe(
            "ReasoningError",
        );
        expect(exception?.attributes?.["exception.message"]).toBe(
            "reasoning failed",
        );
        expect(exception?.attributes?.["exception.stacktrace"]).toBeUndefined();
    });

    it("records cancellation with a safe abort exception", async () => {
        const error = new DOMException("private timeout detail", "AbortError");

        await expect(
            wrapReasoningSpan(ATTRIBUTES, async () => {
                throw error;
            }),
        ).rejects.toBe(error);

        const span = getOnlySpan(manager, "typeagent.reasoning");
        expect(span.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "cancelled",
        });
        const exception = span.events.find(
            (event) => event.name === "exception",
        );
        expect(exception?.attributes?.["exception.type"]).toBe("AbortError");
        expect(exception?.attributes?.["exception.message"]).toBe("cancelled");
    });
});

describe("emitReasoningToolCall", () => {
    it("is a no-op without an active reasoning span", () => {
        expect(() => emitReasoningToolCall(1)).not.toThrow();
    });
});
