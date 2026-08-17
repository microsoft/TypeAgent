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

    it("summarizes LLM calls without prompt or response content", () => {
        expect(
            getStructuredLogMessage("aiclient:llm:started", {
                provider: "azure",
                model: "GPT_4_1",
                streaming: true,
                phase: "translation",
                purpose: "schema-selection",
                scope: "foreground",
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
                phase: "background",
                purpose: "cache-generation",
                scope: "background",
            }),
        ).toBe(
            "LLM succeeded: background.cache-generation [background] (azure/GPT_4_1) in 1234 ms (456 tokens)",
        );
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
