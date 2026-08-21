// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getStructuredLogMessage } from "../src/logger/structuredLogMessage.js";

describe("getStructuredLogMessage", () => {
    it("summarizes the primary request lifecycle", () => {
        expect(
            getStructuredLogMessage("dispatcher:server:requestReceived", {}),
        ).toBe("Request received by agent server");
        expect(
            getStructuredLogMessage("dispatcher:requestQueue:submit", {
                queuedAhead: 2,
            }),
        ).toBe("Request accepted and queued (2 ahead)");
        expect(
            getStructuredLogMessage("dispatcher:translation:started", {
                count: 12,
            }),
        ).toBe("Translation started with 12 candidate schemas");
        expect(
            getStructuredLogMessage("dispatcher:translation:completed", {
                status: "succeeded",
                strategy: "translate",
                actionNames: ["chat.generateResponse"],
            }),
        ).toBe("Translation succeeded via translate: chat.generateResponse");
        expect(
            getStructuredLogMessage("dispatcher:action:completed", {
                status: "succeeded",
                schemaName: "chat",
                actionName: "generateResponse",
            }),
        ).toBe("Action succeeded: chat.generateResponse");
        expect(
            getStructuredLogMessage("dispatcher:request:completed", {
                status: "handled",
            }),
        ).toBe("Request completed: handled");
        expect(
            getStructuredLogMessage("dispatcher:server:responseReady", {
                status: "handled",
            }),
        ).toBe("Response ready: handled");
    });

    it("includes phase duration and routing nuance when present", () => {
        expect(
            getStructuredLogMessage("dispatcher:translation:completed", {
                status: "succeeded",
                strategy: "translate",
                elapsedMs: 42,
                fallback: true,
                retryCount: 2,
                actionNames: ["chat.generateResponse"],
            }),
        ).toBe(
            "Translation succeeded via translate [fallback, retry x2] in 42 ms: chat.generateResponse",
        );
        expect(
            getStructuredLogMessage("dispatcher:translation:completed", {
                status: "succeeded",
                strategy: "grammar",
                elapsedMs: 3,
                actionNames: [],
            }),
        ).toBe("Translation succeeded via grammar in 3 ms");
        expect(
            getStructuredLogMessage("dispatcher:action:completed", {
                status: "succeeded",
                schemaName: "chat",
                actionName: "generateResponse",
                elapsedMs: 8,
            }),
        ).toBe("Action succeeded: chat.generateResponse in 8 ms");
    });

    it("notes a mixed cache-then-LLM route that strategy alone hides", () => {
        expect(
            getStructuredLogMessage("dispatcher:translation:completed", {
                status: "succeeded",
                strategy: "construction",
                routes: ["cache", "llm"],
                elapsedMs: 12,
                actionNames: ["player.play"],
            }),
        ).toBe(
            "Translation succeeded via construction [+llm] in 12 ms: player.play",
        );
        // A pure LLM translation already reads as "translate"; no +llm noise.
        expect(
            getStructuredLogMessage("dispatcher:translation:completed", {
                status: "succeeded",
                strategy: "translate",
                routes: ["llm"],
                elapsedMs: 5,
                actionNames: [],
            }),
        ).toBe("Translation succeeded via translate in 5 ms");
    });

    it("summarizes LLM calls without prompt or response content", () => {
        expect(
            getStructuredLogMessage("aiclient:llm:started", {
                provider: "azure",
                model: "GPT_4_1",
                streaming: true,
                phase: "translation",
                purpose: "schema-selection",
                scope: "foreground",
                classificationSource: "explicit",
            }),
        ).toBe(
            "LLM started: translation.schema-selection (azure/GPT_4_1) (streaming)",
        );
        expect(
            getStructuredLogMessage("aiclient:llm:completed", {
                provider: "azure",
                model: "GPT_4_1",
                status: "succeeded",
                elapsedMs: 1234,
                totalTokens: 456,
                phase: "explanation",
                purpose: "cache-generation",
                scope: "background",
                classificationSource: "explicit",
            }),
        ).toBe(
            "LLM succeeded: explanation.cache-generation [background] (azure/GPT_4_1) in 1234 ms (456 tokens)",
        );
        expect(
            getStructuredLogMessage("aiclient:llm:started", {
                phase: "unknown",
                purpose: "unknown",
                scope: "foreground",
                classificationSource: "default",
            }),
        ).toBe("LLM started: unknown (unclassified)");
        expect(
            getStructuredLogMessage("aiclient:llm:classification:default", {
                scope: "foreground",
                count: 7,
                windowMs: 60_000,
            }),
        ).toBe(
            "7 foreground LLM call(s) ran with default (unclassified) phase/purpose",
        );
    });

    it("summarizes a failure from its classification, never its message", () => {
        expect(
            getStructuredLogMessage("dispatcher:command:exception", {
                requestId: "request-1",
                errorCategory: "rate_limit",
                httpStatus: 429,
                retryable: true,
                // Present in the raw event for the private diagnostic sinks;
                // never rendered.
                request: "play some private music",
                name: "Error",
                message: "secret provider detail",
                stack: "at secret()",
            }),
        ).toBe("Command failed: rate_limit (HTTP 429, retryable)");
        expect(
            getStructuredLogMessage("dispatcher:command:exception", {
                errorCategory: "internal",
            }),
        ).toBe("Command failed: internal");
        expect(
            getStructuredLogMessage("dispatcher:command:exception", {
                errorCategory: "network",
                errorCode: "ECONNREFUSED",
            }),
        ).toBe("Command failed: network (ECONNREFUSED)");
    });

    it("appends the classification to failed completions only", () => {
        expect(
            getStructuredLogMessage("dispatcher:action:completed", {
                status: "failed",
                schemaName: "player",
                actionName: "play",
                elapsedMs: 4,
                errorCategory: "timeout",
                retryable: true,
            }),
        ).toBe("Action failed: player.play in 4 ms [timeout (retryable)]");
        expect(
            getStructuredLogMessage("dispatcher:translation:completed", {
                status: "failed",
                strategy: "translate",
                actionNames: [],
                errorCategory: "provider",
                httpStatus: 500,
                retryable: true,
            }),
        ).toBe(
            "Translation failed via translate [provider (HTTP 500, retryable)]",
        );
        expect(
            getStructuredLogMessage("aiclient:llm:completed", {
                provider: "azure",
                status: "failed",
                elapsedMs: 12,
                phase: "translation",
                purpose: "action-generation",
                scope: "foreground",
                errorCategory: "rate_limit",
                httpStatus: 429,
                retryable: true,
            }),
        ).toBe(
            "LLM failed: translation.action-generation (azure) in 12 ms [rate_limit (HTTP 429, retryable)]",
        );
        // Cancellations carry no classification, so the line is unchanged.
        expect(
            getStructuredLogMessage("dispatcher:action:completed", {
                status: "cancelled",
                schemaName: "player",
                actionName: "play",
            }),
        ).toBe("Action cancelled: player.play");
    });

    it("does not invent messages for diagnostic events", () => {
        expect(
            getStructuredLogMessage("debug", {
                namespace: "typeagent:test",
            }),
        ).toBeUndefined();
        expect(
            getStructuredLogMessage("custom:event", { value: "detail" }),
        ).toBeUndefined();
    });
});
