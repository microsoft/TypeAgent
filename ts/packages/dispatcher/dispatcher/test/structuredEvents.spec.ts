// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Logger } from "@typeagent/telemetry";
import {
    DISPATCHER_STRUCTURED_EVENTS,
    logActionCompleted,
    logActionStarted,
    logCommandException,
    logRequestCompleted,
    logRequestReceived,
    logTranslationCompleted,
    logTranslationStarted,
} from "../src/otel/structuredEvents.js";

function createCapture(): {
    logger: Logger;
    events: {
        name: string;
        data: Record<string, unknown>;
        severity: string | undefined;
    }[];
} {
    const events: {
        name: string;
        data: Record<string, unknown>;
        severity: string | undefined;
    }[] = [];
    return {
        events,
        logger: {
            logEvent(name, data, severity) {
                events.push({ name, data, severity });
            },
        },
    };
}

describe("dispatcher structured lifecycle events", () => {
    it("records a content-free successful action request lifecycle", () => {
        const { logger, events } = createCapture();

        logRequestReceived(logger, {
            requestId: "request-1",
            connectionId: "connection-1",
            kind: "request",
            attachmentCount: 1,
        });
        logTranslationStarted(logger, {
            requestId: "request-1",
            schemaNames: ["calendar"],
        });
        logTranslationCompleted(logger, {
            requestId: "request-1",
            strategy: "grammar",
            success: true,
            actions: [
                {
                    action: {
                        schemaName: "calendar",
                        actionName: "addEvent",
                    },
                },
            ],
        });
        logActionStarted(logger, {
            requestId: "request-1",
            schemaName: "calendar",
            actionName: "addEvent",
            appAgentName: "calendar",
            actionIndex: 0,
        });
        logActionCompleted(logger, {
            requestId: "request-1",
            schemaName: "calendar",
            actionName: "addEvent",
            appAgentName: "calendar",
            actionIndex: 0,
            success: true,
        });
        logRequestCompleted(logger, "request-1", {
            disposition: {
                status: "handled",
                path: "action",
                schemas: ["calendar"],
            },
        });

        expect(events.map(({ name }) => name)).toEqual([
            DISPATCHER_STRUCTURED_EVENTS.requestReceived,
            DISPATCHER_STRUCTURED_EVENTS.translationStarted,
            DISPATCHER_STRUCTURED_EVENTS.translationCompleted,
            DISPATCHER_STRUCTURED_EVENTS.actionStarted,
            DISPATCHER_STRUCTURED_EVENTS.actionCompleted,
            DISPATCHER_STRUCTURED_EVENTS.requestCompleted,
        ]);
        expect(events[1]?.data).toEqual({
            requestId: "request-1",
            count: 1,
        });
        expect(events[2]?.data).toEqual({
            requestId: "request-1",
            strategy: "grammar",
            success: true,
            status: "succeeded",
            routingReason: "cache_grammar",
            schemaNames: ["calendar"],
            actionNames: ["calendar.addEvent"],
            count: 1,
        });
        expect(events[4]).toMatchObject({
            severity: "info",
            data: { status: "succeeded", success: true },
        });
        expect(events[5]).toMatchObject({
            severity: "info",
            data: {
                status: "handled",
                success: true,
                cancelled: false,
                path: "action",
                schemaNames: ["calendar"],
            },
        });
        expect(JSON.stringify(events)).not.toContain("parameters");
        expect(JSON.stringify(events)).not.toContain("user request");
    });

    it("distinguishes failed and cancelled lifecycle phases", () => {
        const { logger, events } = createCapture();

        logActionCompleted(logger, {
            requestId: "request-2",
            schemaName: "email",
            actionName: "send",
            appAgentName: "email",
            actionIndex: 0,
            success: false,
        });
        logRequestCompleted(logger, "request-2", { cancelled: true });
        logTranslationCompleted(logger, {
            requestId: "request-2",
            strategy: "translate",
            success: false,
            cancelled: true,
            actions: [],
        });
        logActionCompleted(logger, {
            requestId: "request-2",
            schemaName: "email",
            actionName: "send",
            appAgentName: "email",
            actionIndex: 1,
            success: false,
            cancelled: true,
        });

        expect(events[0]).toMatchObject({
            severity: "error",
            data: { status: "failed", success: false },
        });
        expect(events[1]).toMatchObject({
            severity: "warning",
            data: {
                status: "cancelled",
                success: false,
                cancelled: true,
            },
        });
        expect(events[2]).toMatchObject({
            severity: "warning",
            data: {
                status: "cancelled",
                success: false,
                cancelled: true,
            },
        });
        expect(events[3]).toMatchObject({
            severity: "warning",
            data: {
                status: "cancelled",
                success: false,
                cancelled: true,
            },
        });
    });
});

describe("dispatcher failure classification", () => {
    it("records a command exception with a bounded classification", () => {
        const { logger, events } = createCapture();

        logCommandException(logger, {
            requestId: "request-4",
            request: "play some private music",
            error: Object.assign(new Error("secret provider detail"), {
                status: 429,
                code: "ETIMEDOUT",
            }),
        });

        expect(events[0]?.name).toBe("command:exception");
        expect(events[0]?.severity).toBe("error");
        expect(events[0]?.data).toMatchObject({
            requestId: "request-4",
            // Code and status come from the same error; the code table wins
            // the category.
            errorCategory: "timeout",
            errorCode: "ETIMEDOUT",
            httpStatus: 429,
            retryable: true,
        });
    });

    it("does not export failure fields for a wrapped cancellation", () => {
        const { logger, events } = createCapture();
        const error = Object.assign(new Error("private wrapper detail"), {
            cause: new DOMException("private abort detail", "AbortError"),
        });

        logCommandException(logger, {
            requestId: "request-4a",
            request: "private request",
            error,
        });

        expect(events[0]?.data).not.toHaveProperty("errorCategory");
        expect(events[0]?.data).not.toHaveProperty("errorCode");
        expect(events[0]?.data).not.toHaveProperty("httpStatus");
        expect(events[0]?.data).not.toHaveProperty("retryable");
        expect(events[0]?.severity).toBe("warning");
    });

    it("drops a code outside the reviewed allowlist", () => {
        const { logger, events } = createCapture();

        logCommandException(logger, {
            requestId: "request-4b",
            request: "play some private music",
            error: Object.assign(new Error("secret provider detail"), {
                status: 429,
                code: "ERR_TENANT_8f14e45f",
            }),
        });

        expect(events[0]?.data).toMatchObject({
            errorCategory: "rate_limit",
            httpStatus: 429,
        });
        expect(events[0]?.data).not.toHaveProperty("errorCode");
    });

    it("survives an error whose property reads throw", () => {
        const { logger, events } = createCapture();
        const hostile = new Proxy(new Error("hostile"), {
            get(_target, property) {
                throw new Error(`no reads allowed: ${String(property)}`);
            },
        });

        expect(() =>
            logCommandException(logger, {
                requestId: "request-4c",
                request: "private request",
                error: hostile,
            }),
        ).not.toThrow();
        expect(events[0]?.data).toMatchObject({
            requestId: "request-4c",
            errorCategory: "internal",
        });
        expect(events[0]?.data).not.toHaveProperty("name");
        expect(events[0]?.data).not.toHaveProperty("message");
        expect(events[0]?.data).not.toHaveProperty("stack");
    });

    it("keeps the raw error detail for the private diagnostic sinks", () => {
        const { logger, events } = createCapture();
        const error = new Error("secret provider detail");
        error.name = "TypeError";

        logCommandException(logger, {
            requestId: "request-5",
            request: "play some private music",
            error,
        });

        // These fields stay in the local debug and opt-in database sinks;
        // `createDispatcherOtelLoggerSink` strips them before OTel.
        expect(events[0]?.data).toMatchObject({
            request: "play some private music",
            name: "TypeError",
            message: "secret provider detail",
            stack: expect.any(String),
        });
    });

    it("survives a non-Error throw without inventing raw fields", () => {
        const { logger, events } = createCapture();

        logCommandException(logger, {
            requestId: "request-6",
            request: "private request",
            error: "just a string",
        });

        expect(events[0]?.data).toMatchObject({
            requestId: "request-6",
            errorCategory: "internal",
        });
        expect(events[0]?.data).not.toHaveProperty("message");
        expect(events[0]?.data).not.toHaveProperty("stack");
        expect(events[0]?.data).not.toHaveProperty("name");
    });

    it("classifies failed phase completions and leaves the rest untouched", () => {
        const { logger, events } = createCapture();
        const timeout = new Error("secret endpoint detail");
        timeout.name = "TimeoutError";

        logActionCompleted(logger, {
            requestId: "request-7",
            schemaName: "email",
            actionName: "send",
            appAgentName: "email",
            actionIndex: 0,
            success: false,
            error: timeout,
        });
        logTranslationCompleted(logger, {
            requestId: "request-7",
            strategy: "translate",
            success: false,
            error: Object.assign(new Error("secret detail"), { status: 503 }),
            actions: [],
        });
        // Cancellation is a disposition, not a failure to classify.
        logActionCompleted(logger, {
            requestId: "request-7",
            schemaName: "email",
            actionName: "send",
            appAgentName: "email",
            actionIndex: 1,
            success: false,
            cancelled: true,
            error: new DOMException("The operation was aborted.", "AbortError"),
        });
        logActionCompleted(logger, {
            requestId: "request-7",
            schemaName: "email",
            actionName: "send",
            appAgentName: "email",
            actionIndex: 2,
            success: true,
        });

        expect(events[0]?.data).toMatchObject({
            status: "failed",
            errorCategory: "timeout",
            retryable: true,
        });
        expect(events[1]?.data).toMatchObject({
            status: "failed",
            errorCategory: "provider",
            httpStatus: 503,
            retryable: true,
        });
        expect(events[2]?.data).not.toHaveProperty("errorCategory");
        expect(events[3]?.data).not.toHaveProperty("errorCategory");
        expect(events[0]?.data).not.toHaveProperty("error");
        expect(events[1]?.data).not.toHaveProperty("error");
        expect(JSON.stringify(events)).not.toContain("secret");
    });

    it("invents no classification when the failure had no thrown value", () => {
        const { logger, events } = createCapture();

        // The common agent failure: a typed `ActionResult.error` with no
        // exception, so there is nothing to classify.
        logActionCompleted(logger, {
            requestId: "request-8",
            schemaName: "email",
            actionName: "send",
            appAgentName: "email",
            actionIndex: 0,
            success: false,
        });
        logTranslationCompleted(logger, {
            requestId: "request-8",
            strategy: "translate",
            success: false,
            actions: [],
        });

        expect(events[0]?.data).toMatchObject({ status: "failed" });
        expect(events[0]?.data).not.toHaveProperty("errorCategory");
        expect(events[1]?.data).not.toHaveProperty("errorCategory");
    });
});

// `cancelled`, `status`, severity, and the classification fields all derive
// from one classification, so a cancellation the call site could not see -
// one wrapped as a `cause` - is a cancellation on every one of them.
describe("dispatcher cancellation coherence", () => {
    function wrappedAbort(): Error {
        return Object.assign(new Error("Error translating request"), {
            cause: new DOMException("The operation was aborted.", "AbortError"),
        });
    }

    it("recognizes a wrapped cancellation on action completion", () => {
        const { logger, events } = createCapture();

        logActionCompleted(logger, {
            requestId: "request-9",
            schemaName: "email",
            actionName: "send",
            appAgentName: "email",
            actionIndex: 0,
            success: false,
            // The call site only knows the abort signal has not fired yet.
            cancelled: false,
            error: wrappedAbort(),
        });

        expect(events[0]).toMatchObject({
            severity: "warning",
            data: { status: "cancelled", cancelled: true, success: false },
        });
        expect(events[0]?.data).not.toHaveProperty("errorCategory");
    });

    it("recognizes a wrapped cancellation on translation completion", () => {
        const { logger, events } = createCapture();

        logTranslationCompleted(logger, {
            requestId: "request-9",
            strategy: "translate",
            success: false,
            cancelled: false,
            error: wrappedAbort(),
            actions: [],
        });

        expect(events[0]).toMatchObject({
            severity: "warning",
            data: { status: "cancelled", cancelled: true, success: false },
        });
        expect(events[0]?.data).not.toHaveProperty("errorCategory");
    });

    it("still honors a cancellation the call site knows about on its own", () => {
        const { logger, events } = createCapture();

        // The abort signal fired while a handler was failing for an unrelated
        // reason; the disposition is still cancellation.
        logActionCompleted(logger, {
            requestId: "request-10",
            schemaName: "email",
            actionName: "send",
            appAgentName: "email",
            actionIndex: 0,
            success: false,
            cancelled: true,
            error: Object.assign(new Error("secret detail"), { status: 500 }),
        });

        expect(events[0]).toMatchObject({
            severity: "warning",
            data: { status: "cancelled", cancelled: true },
        });
        expect(events[0]?.data).not.toHaveProperty("errorCategory");
        expect(events[0]?.data).not.toHaveProperty("httpStatus");
    });

    it("does not mark an ordinary failure as cancelled", () => {
        const { logger, events } = createCapture();

        logActionCompleted(logger, {
            requestId: "request-11",
            schemaName: "email",
            actionName: "send",
            appAgentName: "email",
            actionIndex: 0,
            success: false,
            cancelled: false,
            error: Object.assign(new Error("secret detail"), { status: 503 }),
        });

        expect(events[0]).toMatchObject({
            severity: "error",
            data: {
                status: "failed",
                cancelled: false,
                errorCategory: "provider",
                httpStatus: 503,
                retryable: true,
            },
        });
    });
});

describe("translation completion elapsed timing and routing rationale", () => {
    it("carries a valid elapsedMs on the success path", () => {
        const { logger, events } = createCapture();

        logTranslationCompleted(logger, {
            requestId: "request-3",
            strategy: "translate",
            success: true,
            elapsedMs: 1234,
            actions: [],
        });

        const data = events[0]!.data;
        expect(typeof data.elapsedMs).toBe("number");
        expect(Number.isFinite(data.elapsedMs)).toBe(true);
        expect(data.elapsedMs).toBe(1234);
    });

    it("omits a routing reason on a cache-stage failure with no observed model call", () => {
        const { logger, events } = createCapture();

        // Failure during cache matching before any LLM call: `strategy` is a
        // placeholder here, so no `routingReason` must be fabricated.
        logTranslationCompleted(logger, {
            requestId: "request-4",
            strategy: "translate",
            success: false,
            cancelled: true,
            elapsedMs: 42,
            routing: { fallback: true, retryCount: 1 },
            actions: [],
        });

        expect(events[0]).toMatchObject({
            severity: "warning",
            data: {
                status: "cancelled",
                elapsedMs: 42,
                fallback: true,
                retryCount: 1,
            },
        });
        // No terminal route was observed, so the reason is omitted rather than
        // reported as llm_translation.
        expect(events[0]!.data).not.toHaveProperty("routingReason");
    });

    it("reports llm_translation on a failure that reached the model", () => {
        const { logger, events } = createCapture();

        logTranslationCompleted(logger, {
            requestId: "request-4b",
            strategy: "translate",
            success: false,
            cancelled: false,
            elapsedMs: 99,
            routing: {
                matchOutcome: "miss",
                routes: ["llm"],
                fallback: false,
                retryCount: 0,
            },
            actions: [],
        });

        expect(events[0]!.data).toMatchObject({
            status: "failed",
            routingReason: "llm_translation",
            routes: ["llm"],
        });
    });

    it("surfaces a mixed cache-then-LLM route without collapsing the truth", () => {
        const { logger, events } = createCapture();

        // Activity-context translation resolved from the construction cache but
        // still called the model for an unknown action. `strategy` stays
        // "construction" for compatibility while `routes` records both.
        logTranslationCompleted(logger, {
            requestId: "request-mixed",
            strategy: "construction",
            success: true,
            elapsedMs: 321,
            routing: {
                matchOutcome: "miss",
                routes: ["cache", "llm"],
                fallback: false,
                retryCount: 0,
            },
            actions: [{ action: { schemaName: "player", actionName: "play" } }],
        });

        expect(events[0]!.data).toMatchObject({
            strategy: "construction",
            routingReason: "cache_construction",
            routes: ["cache", "llm"],
        });
    });

    it.each([
        ["user", "user_action"],
        ["construction", "cache_construction"],
        ["grammar", "cache_grammar"],
        ["translate", "llm_translation"],
    ])("maps strategy %s to routingReason %s", (strategy, expected) => {
        const { logger, events } = createCapture();

        logTranslationCompleted(logger, {
            requestId: "request-reason",
            strategy,
            success: true,
            actions: [],
        });

        expect(events[0]!.data.routingReason).toBe(expected);
    });

    it("surfaces the cache-miss + fallback direct-translation path", () => {
        const { logger, events } = createCapture();

        logTranslationCompleted(logger, {
            requestId: "request-5",
            strategy: "translate",
            success: true,
            elapsedMs: 500,
            routing: {
                matchOutcome: "miss",
                fallback: true,
                retryCount: 2,
            },
            actions: [{ action: { schemaName: "email", actionName: "send" } }],
        });

        expect(events[0]!.data).toMatchObject({
            routingReason: "llm_translation",
            matchOutcome: "miss",
            fallback: true,
            retryCount: 2,
        });
    });

    it("surfaces a bypassed-cache reason without inventing a match outcome", () => {
        const { logger, events } = createCapture();

        logTranslationCompleted(logger, {
            requestId: "request-6",
            strategy: "translate",
            success: true,
            routing: {
                cacheBypassReason: "cache_disabled",
                fallback: false,
                retryCount: 0,
            },
            actions: [],
        });

        const data = events[0]!.data;
        expect(data).toMatchObject({
            routingReason: "llm_translation",
            cacheBypassReason: "cache_disabled",
            fallback: false,
            retryCount: 0,
        });
        expect(data).not.toHaveProperty("matchOutcome");
    });

    it("omits routing fields entirely when no summary is available", () => {
        const { logger, events } = createCapture();

        logTranslationCompleted(logger, {
            requestId: "request-7",
            strategy: "grammar",
            success: true,
            actions: [],
        });

        const data = events[0]!.data;
        expect(data).not.toHaveProperty("fallback");
        expect(data).not.toHaveProperty("retryCount");
        expect(data).not.toHaveProperty("matchOutcome");
        expect(data).not.toHaveProperty("elapsedMs");
        // The terminal reason is still derived from the strategy alone.
        expect(data.routingReason).toBe("cache_grammar");
    });

    it("stamps a valid elapsedMs on completed actions", () => {
        const { logger, events } = createCapture();

        logActionCompleted(logger, {
            requestId: "request-8",
            schemaName: "calendar",
            actionName: "addEvent",
            appAgentName: "calendar",
            actionIndex: 0,
            success: true,
            elapsedMs: 7,
        });

        expect(events[0]!.data.elapsedMs).toBe(7);
    });
});
