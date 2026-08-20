// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Logger } from "@typeagent/telemetry";
import {
    DISPATCHER_STRUCTURED_EVENTS,
    logActionCompleted,
    logActionStarted,
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
