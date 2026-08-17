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
import { withChatModelTelemetryContext } from "../src/chatModelTelemetryContext.js";

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

    it("records successful complete calls as typeagent.llm spans", async () => {
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
            "typeagent.llm.phase": "unknown",
            "typeagent.llm.purpose": "unknown",
            "typeagent.llm.scope": "foreground",
        });
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
        const events: Array<{
            name: string;
            data: Record<string, unknown>;
        }> = [];
        const logger: Logger = {
            logEvent(name, data) {
                events.push({ name, data });
            },
        };

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
        const events: Array<{
            name: string;
            data: Record<string, unknown>;
        }> = [];
        const logger: Logger = {
            logEvent(name, data) {
                events.push({ name, data });
            },
        };
        const model = instrumentChatModel(
            createModel(),
            { provider: "test-provider" },
            logger,
        );

        await withChatModelTelemetryContext(
            {
                phase: "background",
                purpose: "cache-generation",
                scope: "background",
            },
            () => model.complete("private prompt"),
        );

        expect(
            spans.findSpansByName("typeagent.llm")[0]?.attributes,
        ).toMatchObject({
            "typeagent.llm.phase": "background",
            "typeagent.llm.purpose": "cache-generation",
            "typeagent.llm.scope": "background",
        });
        expect(events.map(({ data }) => data)).toEqual([
            expect.objectContaining({
                phase: "background",
                purpose: "cache-generation",
                scope: "background",
            }),
            expect.objectContaining({
                phase: "background",
                purpose: "cache-generation",
                scope: "background",
            }),
        ]);
    });
});
