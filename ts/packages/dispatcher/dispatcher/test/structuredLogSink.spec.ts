// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { LogEvent, LoggerSink } from "@typeagent/telemetry";
import { createDispatcherOtelLoggerSink } from "../src/otel/structuredLogSink.js";

describe("dispatcher structured log projection", () => {
    it("keeps bounded operational metadata and excludes user content", () => {
        const captured: LogEvent[] = [];
        const target: LoggerSink = {
            logEvent(event) {
                captured.push(event);
            },
        };
        const sink = createDispatcherOtelLoggerSink(target);

        sink.logEvent({
            eventName: "translate",
            timestamp: new Date().toISOString(),
            severity: "error",
            event: {
                sessionId: "session",
                requestId: "request",
                elapsedMs: 42,
                success: false,
                actionIndex: 1,
                actionNames: ["calendar.addEvent"],
                provider: "azure",
                model: "gpt-5",
                operation: "chat",
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
                streaming: true,
                path: "action",
                cancelled: false,
                schemaNames: ["calendar", "email"],
                routingReason: "llm_translation",
                matchOutcome: "miss",
                cacheBypassReason: "cache_disabled",
                routes: ["cache", "llm"],
                fallback: true,
                retryCount: 2,
                request: "PRIVATE_REQUEST_MARKER",
                history: ["PRIVATE_HISTORY_MARKER"],
                actions: [{ parameters: "PRIVATE_ACTION_MARKER" }],
                message: "PRIVATE_ERROR_MARKER",
                stack: "PRIVATE_STACK_MARKER",
                comment: "PRIVATE_COMMENT_MARKER",
                context: "PRIVATE_CONTEXT_MARKER",
                unknown: "PRIVATE_UNKNOWN_MARKER",
            },
        });

        expect(captured).toEqual([
            {
                eventName: "translate",
                timestamp: expect.any(String),
                severity: "error",
                event: {
                    sessionId: "session",
                    requestId: "request",
                    elapsedMs: 42,
                    success: false,
                    actionIndex: 1,
                    actionNames: ["calendar.addEvent"],
                    provider: "azure",
                    model: "gpt-5",
                    operation: "chat",
                    inputTokens: 10,
                    outputTokens: 5,
                    totalTokens: 15,
                    streaming: true,
                    path: "action",
                    cancelled: false,
                    schemaNames: ["calendar", "email"],
                    routingReason: "llm_translation",
                    matchOutcome: "miss",
                    cacheBypassReason: "cache_disabled",
                    routes: ["cache", "llm"],
                    fallback: true,
                    retryCount: 2,
                },
            },
        ]);
        expect(JSON.stringify(captured)).not.toContain("PRIVATE_");
    });

    it("keeps the failure classification and drops the raw error", () => {
        const captured: LogEvent[] = [];
        const sink = createDispatcherOtelLoggerSink({
            logEvent(event) {
                captured.push(event);
            },
        });

        // Exactly the shape `logCommandException` produces: bounded
        // classification for OTel, raw error detail for the local debug and
        // opt-in database sinks only.
        sink.logEvent({
            eventName: "command:exception",
            timestamp: new Date().toISOString(),
            severity: "error",
            event: {
                requestId: "request",
                errorCategory: "rate_limit",
                errorCode: "ERR_TOO_MANY",
                httpStatus: 429,
                retryable: true,
                request: "PRIVATE_REQUEST_MARKER",
                name: "PRIVATE_NAME_MARKER",
                message: "PRIVATE_ERROR_MARKER",
                stack: "PRIVATE_STACK_MARKER",
            },
        });

        expect(captured[0]?.event).toEqual({
            requestId: "request",
            errorCategory: "rate_limit",
            errorCode: "ERR_TOO_MANY",
            httpStatus: 429,
            retryable: true,
        });
        expect(JSON.stringify(captured)).not.toContain("PRIVATE_");
    });

    it("drops oversized and incorrectly typed allowlisted values", () => {
        const captured: LogEvent[] = [];
        const sink = createDispatcherOtelLoggerSink({
            logEvent(event) {
                captured.push(event);
            },
        });

        sink.logEvent({
            eventName: "requestQueue:complete",
            timestamp: new Date().toISOString(),
            event: {
                requestId: "x".repeat(257),
                runMs: Number.NaN,
                running: "yes",
                schemaNames: Array.from({ length: 65 }, () => "schema"),
            },
        });

        expect(captured[0]?.event).toEqual({});
    });

    it("passes through rpc lifecycle fields and their classification", () => {
        const captured: LogEvent[] = [];
        const sink = createDispatcherOtelLoggerSink({
            logEvent(event) {
                captured.push(event);
            },
        });

        // Exactly the shape an `rpc:completed` event carries: bounded
        // operational fields plus normalized classification. Nothing derived
        // from the thrown value's message or stack must survive.
        sink.logEvent({
            eventName: "rpc:completed",
            timestamp: new Date().toISOString(),
            severity: "error",
            event: {
                role: "client",
                channel: "agent:calendar",
                method: "executeAction",
                callId: 3,
                status: "failed",
                success: false,
                elapsedMs: 12,
                errorCategory: "network",
                errorCode: "ECONNREFUSED",
                httpStatus: undefined,
                retryable: true,
                // Anything not on the allowlist must be dropped even if it
                // slipped past the RPC layer.
                message: "PRIVATE_ERROR_MARKER",
                stack: "PRIVATE_STACK_MARKER",
                args: ["PRIVATE_ARGS_MARKER"],
            },
        });

        expect(captured[0]?.event).toEqual({
            role: "client",
            channel: "agent:calendar",
            method: "executeAction",
            callId: 3,
            status: "failed",
            success: false,
            elapsedMs: 12,
            errorCategory: "network",
            errorCode: "ECONNREFUSED",
            retryable: true,
        });
        expect(JSON.stringify(captured)).not.toContain("PRIVATE_");
    });
});
