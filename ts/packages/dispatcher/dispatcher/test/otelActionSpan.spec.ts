// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
    createInMemorySpanManager,
    type CapturedSpan,
    type InMemorySpanManager,
} from "@typeagent/telemetry/testing/inMemorySpanManager";
import { wrapRootRequestSpan } from "../src/otel/rootRequestSpan.js";
import {
    recordActionFlowException,
    recordActionHandlerException,
    recordActionResultError,
    recordActionSetupFailure,
    wrapActionSpan,
} from "../src/otel/actionSpan.js";

const ATTRIBUTES = {
    agentName: "player",
    actionName: "play",
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

describe("wrapActionSpan", () => {
    let manager: InMemorySpanManager;

    beforeEach(() => {
        manager = createInMemorySpanManager();
    });

    afterEach(async () => {
        await manager.shutdown();
    });

    it("creates one action span with action and correlation attributes", async () => {
        await wrapActionSpan(ATTRIBUTES, async () => undefined);

        const span = getOnlySpan(manager, "typeagent.action");
        expect(span.attributes["typeagent.agent.name"]).toBe("player");
        expect(span.attributes["typeagent.action.name"]).toBe("play");
        expect(span.attributes["typeagent.session.id"]).toBe("session-abc");
        expect(span.attributes["typeagent.activation.id"]).toBe(
            "activation-123",
        );
        expect(span.attributes["typeagent.trace.id"]).toBe("trace-xyz");
        expect(span.status.code).toBe(SpanStatusCode.UNSET);
    });

    it("creates a child of the active request span", async () => {
        await wrapRootRequestSpan(ATTRIBUTES, async () => {
            await wrapActionSpan(ATTRIBUTES, async () => undefined);
            return {};
        });

        manager.assertParentChild(
            getOnlySpan(manager, "typeagent.request"),
            getOnlySpan(manager, "typeagent.action"),
        );
    });

    it("creates nested action spans for actions dispatched by another action", async () => {
        await wrapActionSpan(ATTRIBUTES, async () => {
            await wrapActionSpan(
                { agentName: "list", actionName: "add" },
                async () => undefined,
            );
        });

        const spans = manager.findSpansByName("typeagent.action");
        expect(spans).toHaveLength(2);
        manager.assertParentChild(spans[1]!, spans[0]!);
    });

    it("creates sibling spans for sequential actions under one request", async () => {
        await wrapRootRequestSpan(ATTRIBUTES, async () => {
            await wrapActionSpan(
                { agentName: "player", actionName: "play" },
                async () => undefined,
            );
            await wrapActionSpan(
                { agentName: "player", actionName: "pause" },
                async () => undefined,
            );
            return {};
        });

        const requestSpan = getOnlySpan(manager, "typeagent.request");
        const actionSpans = manager.findSpansByName("typeagent.action");
        expect(actionSpans).toHaveLength(2);
        for (const actionSpan of actionSpans) {
            manager.assertParentChild(requestSpan, actionSpan);
        }
    });

    it("keeps the action span active through asynchronous work", async () => {
        let activeSpanId: string | undefined;

        await wrapActionSpan(ATTRIBUTES, async () => {
            await Promise.resolve();
            activeSpanId = trace.getActiveSpan()?.spanContext().spanId;
        });

        expect(activeSpanId).toBe(
            getOnlySpan(manager, "typeagent.action").spanContext().spanId,
        );
    });

    it("records bounded setup and typed-result failures", async () => {
        await wrapActionSpan(ATTRIBUTES, async (span) => {
            recordActionSetupFailure(span, "agent_not_ready");
        });
        await wrapActionSpan(ATTRIBUTES, async (span) => {
            recordActionResultError(span);
        });

        const spans = manager.findSpansByName("typeagent.action");
        expect(spans[0]!.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "agent_not_ready",
        });
        expect(spans[0]!.events[0]).toMatchObject({
            name: "action.setup.failed",
            attributes: { failure_kind: "agent_not_ready" },
        });
        expect(spans[1]!.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "result_error",
        });
        expect(spans[1]!.events[0]).toMatchObject({
            name: "action.result.error",
            attributes: { failure_kind: "result_error" },
        });
    });

    it("records converted handler exceptions safely", async () => {
        await wrapActionSpan(ATTRIBUTES, async (span) => {
            recordActionHandlerException(span);
        });

        const span = getOnlySpan(manager, "typeagent.action");
        expect(span.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "action handler failed",
        });
        const exception = span.events.find(
            (event) => event.name === "exception",
        );
        expect(exception?.attributes?.["exception.type"]).toBe(
            "ActionHandlerError",
        );
        expect(exception?.attributes?.["exception.message"]).toBe(
            "action handler failed",
        );
        expect(exception?.attributes?.["exception.stacktrace"]).toBeUndefined();
    });

    it("records converted flow exceptions safely", async () => {
        await wrapActionSpan(ATTRIBUTES, async (span) => {
            recordActionFlowException(span);
        });

        const span = getOnlySpan(manager, "typeagent.action");
        expect(span.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "action flow failed",
        });
        const exception = span.events.find(
            (event) => event.name === "exception",
        );
        expect(exception?.attributes?.["exception.type"]).toBe(
            "ActionFlowError",
        );
        expect(exception?.attributes?.["exception.message"]).toBe(
            "action flow failed",
        );
        expect(exception?.attributes?.["exception.stacktrace"]).toBeUndefined();
    });

    it("records privacy-safe details when an action exception escapes", async () => {
        const error = new Error(
            "private action payload sk-secret12345678901234567890",
        );

        await expect(
            wrapActionSpan(ATTRIBUTES, async () => {
                throw error;
            }),
        ).rejects.toBe(error);

        const span = getOnlySpan(manager, "typeagent.action");
        expect(span.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "action failed",
        });
        const exception = span.events.find(
            (event) => event.name === "exception",
        );
        expect(exception?.attributes?.["exception.type"]).toBe("ActionError");
        expect(exception?.attributes?.["exception.message"]).toBe(
            "action failed",
        );
        expect(exception?.attributes?.["exception.stacktrace"]).toBeUndefined();
    });

    it("classifies cancellation without exporting the abort message", async () => {
        const error = new DOMException("private abort details", "AbortError");

        await expect(
            wrapActionSpan(ATTRIBUTES, async () => {
                throw error;
            }),
        ).rejects.toBe(error);

        const span = getOnlySpan(manager, "typeagent.action");
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
