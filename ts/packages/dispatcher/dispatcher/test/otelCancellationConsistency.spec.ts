// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SpanStatusCode } from "@opentelemetry/api";
import type { ActionContext } from "@typeagent/agent-sdk";
import type { Logger } from "@typeagent/telemetry";
import {
    createInMemorySpanManager,
    type CapturedSpan,
    type InMemorySpanManager,
} from "@typeagent/telemetry/testing/inMemorySpanManager";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";
import { wrapActionSpan } from "../src/otel/actionSpan.js";
import { runInReasoningSpan } from "../src/otel/reasoningSpan.js";
import { wrapRootRequestSpan } from "../src/otel/rootRequestSpan.js";
import {
    logActionCompleted,
    logTranslationCompleted,
} from "../src/otel/structuredEvents.js";
import { wrapTranslationSpan } from "../src/otel/translationSpan.js";

// A phase span and the `*:completed` event recorded next to it must reach the
// same verdict about a cancellation the outermost thrown value does not admit
// to: the abort arrives as a `cause`, or the work was torn down and what
// surfaced is whatever the provider was in the middle of.

const ATTRIBUTES = {
    sessionId: "session-abc",
    activationId: "activation-123",
};

const REQUEST_ID = "request-1";

type CapturedEvent = {
    name: string;
    data: Record<string, unknown>;
    severity: string | undefined;
};

function createCapture(): { logger: Logger; events: CapturedEvent[] } {
    const events: CapturedEvent[] = [];
    return {
        events,
        logger: {
            logEvent(name, data, severity) {
                events.push({ name, data, severity });
            },
        },
    };
}

/** A phase's own error carrying the abort as its `cause`. */
function wrappedAbortError(detail: string): Error {
    return Object.assign(new Error(detail), {
        cause: new DOMException("The operation was aborted.", "AbortError"),
    });
}

function getOnlySpan(manager: InMemorySpanManager, name: string): CapturedSpan {
    const spans = manager.findSpansByName(name);
    if (spans.length !== 1) {
        throw new Error(`Expected one ${name} span, got ${spans.length}`);
    }
    return spans[0]!;
}

function expectCancelledSpan(span: CapturedSpan): void {
    expect(span.status).toEqual({
        code: SpanStatusCode.ERROR,
        message: "cancelled",
    });
    const exception = span.events.find((event) => event.name === "exception");
    expect(exception?.attributes?.["exception.type"]).toBe("AbortError");
    expect(exception?.attributes?.["exception.message"]).toBe("cancelled");
    // Never the phase's failure wording, and never the original message.
    expect(exception?.attributes?.["exception.stacktrace"]).toBeUndefined();
}

function expectCancelledEvent(event: CapturedEvent | undefined): void {
    expect(event?.data).toMatchObject({ status: "cancelled", success: false });
    expect(event?.severity).toBe("warning");
    // A cancellation is a disposition, not a failure to classify.
    expect(event?.data.errorCategory).toBeUndefined();
}

function createReasoningContext(logger: Logger, abortSignal?: AbortSignal) {
    return {
        abortSignal,
        sessionContext: {
            agentContext: {
                session: {},
                logger,
                currentRequestId: { requestId: REQUEST_ID },
            },
        },
    } as unknown as ActionContext<CommandHandlerContext>;
}

describe("span and structured-event cancellation agree", () => {
    let manager: InMemorySpanManager;

    beforeEach(() => {
        manager = createInMemorySpanManager();
    });

    afterEach(async () => {
        await manager.shutdown();
    });

    it("reports a wrapped cancellation as cancelled on the action span and event", async () => {
        const { logger, events } = createCapture();
        const error = wrappedAbortError("private action failure detail");

        await expect(
            wrapActionSpan(ATTRIBUTES, async () => {
                logActionCompleted(logger, {
                    requestId: REQUEST_ID,
                    schemaName: "player",
                    actionName: "play",
                    appAgentName: "player",
                    actionIndex: 0,
                    success: false,
                    // The signal never fired; the abort is inside the error.
                    cancelled: false,
                    error,
                });
                throw error;
            }),
        ).rejects.toBe(error);

        expectCancelledSpan(getOnlySpan(manager, "typeagent.action"));
        expectCancelledEvent(
            events.find(({ name }) => name === "action:completed"),
        );
    });

    it("reports a wrapped cancellation as cancelled on the translation span and event", async () => {
        const { logger, events } = createCapture();
        const error = wrappedAbortError("private translation failure detail");

        await expect(
            wrapTranslationSpan(ATTRIBUTES, async () => {
                throw error;
            }),
        ).rejects.toBe(error);
        logTranslationCompleted(logger, {
            requestId: REQUEST_ID,
            strategy: "translate",
            success: false,
            cancelled: false,
            error,
            actions: [],
        });

        expectCancelledSpan(getOnlySpan(manager, "typeagent.translation"));
        expectCancelledEvent(
            events.find(({ name }) => name === "translation:completed"),
        );
    });

    it("reports a wrapped cancellation as cancelled on the reasoning span and event", async () => {
        const { logger, events } = createCapture();
        const error = wrappedAbortError("private reasoning failure detail");

        await expect(
            runInReasoningSpan(createReasoningContext(logger), async () => {
                throw error;
            }),
        ).rejects.toBe(error);

        expectCancelledSpan(getOnlySpan(manager, "typeagent.reasoning"));
        const event = events.find(({ name }) => name === "reasoning:completed");
        expect(event?.data).toMatchObject({
            status: "cancelled",
            cancelled: true,
            success: false,
        });
        expect(event?.severity).toBe("warning");
    });

    it("reports a wrapped cancellation as cancelled on the request span", async () => {
        const error = wrappedAbortError("private request failure detail");

        await expect(
            wrapRootRequestSpan(ATTRIBUTES, async () => {
                throw error;
            }),
        ).rejects.toBe(error);

        expectCancelledSpan(getOnlySpan(manager, "typeagent.request"));
    });

    it("still records an ordinary failure as a phase failure on both signals", async () => {
        const { logger, events } = createCapture();
        const error = new Error("private provider detail");

        await expect(
            wrapActionSpan(ATTRIBUTES, async () => {
                logActionCompleted(logger, {
                    requestId: REQUEST_ID,
                    schemaName: "player",
                    actionName: "play",
                    appAgentName: "player",
                    actionIndex: 0,
                    success: false,
                    cancelled: false,
                    error,
                });
                throw error;
            }),
        ).rejects.toBe(error);

        const span = getOnlySpan(manager, "typeagent.action");
        expect(span.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "action failed",
        });
        const event = events.find(({ name }) => name === "action:completed");
        expect(event?.data).toMatchObject({
            status: "failed",
            errorCategory: "internal",
        });
        expect(event?.severity).toBe("error");
    });
});

// The thrown value says nothing; the caller knows only because it holds the
// signal that fired.
describe("signal-only cancellation", () => {
    let manager: InMemorySpanManager;

    beforeEach(() => {
        manager = createInMemorySpanManager();
    });

    afterEach(async () => {
        await manager.shutdown();
    });

    it("classifies an action failure from the caller's aborted signal", async () => {
        const { logger, events } = createCapture();
        const controller = new AbortController();
        const error = new Error("private socket detail");

        await expect(
            wrapActionSpan(ATTRIBUTES, async () => {
                controller.abort();
                logActionCompleted(logger, {
                    requestId: REQUEST_ID,
                    schemaName: "player",
                    actionName: "play",
                    appAgentName: "player",
                    actionIndex: 0,
                    success: false,
                    cancelled: controller.signal.aborted,
                    error,
                });
                throw error;
            }, [controller.signal]),
        ).rejects.toBe(error);

        expectCancelledSpan(getOnlySpan(manager, "typeagent.action"));
        expectCancelledEvent(
            events.find(({ name }) => name === "action:completed"),
        );
    });

    it("classifies a reasoning failure from the reasoning deadline signal", async () => {
        const { logger, events } = createCapture();
        const controller = new AbortController();
        const error = new Error("private timeout detail");
        controller.abort(error);

        await expect(
            runInReasoningSpan(
                createReasoningContext(logger),
                async () => {
                    throw error;
                },
                undefined,
                controller.signal,
            ),
        ).rejects.toBe(error);

        expectCancelledSpan(getOnlySpan(manager, "typeagent.reasoning"));
        expect(
            events.find(({ name }) => name === "reasoning:completed")?.data,
        ).toMatchObject({ status: "cancelled", cancelled: true });
    });

    it("classifies a reasoning failure from the request's own signal", async () => {
        const { logger, events } = createCapture();
        const controller = new AbortController();
        controller.abort();
        const error = new Error("private provider detail");

        await expect(
            runInReasoningSpan(
                createReasoningContext(logger, controller.signal),
                async () => {
                    throw error;
                },
            ),
        ).rejects.toBe(error);

        expectCancelledSpan(getOnlySpan(manager, "typeagent.reasoning"));
        expect(
            events.find(({ name }) => name === "reasoning:completed")?.data,
        ).toMatchObject({ status: "cancelled", cancelled: true });
    });
});
