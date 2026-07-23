// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest } from "@jest/globals";
import type { ChatModel } from "@typeagent/aiclient";
import { success } from "typechat";
import type { ReasoningLoopConfig } from "../src/reasoning/reasoningLoopBase.js";
import {
    buildTypeAgentFunctionSchema,
    buildTypeAgentResponsesApiSettings,
    createTypeAgentReasoningSession,
    TYPEAGENT_REASONING_COMPLETION_SETTINGS,
} from "../src/reasoning/typeAgentReasoningAdapter.js";

describe("native TypeAgent reasoning adapter", () => {
    it("bounds each reasoning request while retaining provider retries", () => {
        expect(
            buildTypeAgentResponsesApiSettings(
                "http://127.0.0.1:4627/v1",
                "not-logged",
                "azure/gpt-5.6-luna",
            ),
        ).toMatchObject({
            timeout: 60_000,
            maxRetryAttempts: 1,
        });
    });

    it("uses the requested LiteLLM route through Responses", () => {
        expect(
            buildTypeAgentResponsesApiSettings(
                "http://127.0.0.1:4627/v1",
                "not-logged",
                "azure/gpt-5.6-luna",
                30_000,
            ),
        ).toMatchObject({
            endpoint: "http://127.0.0.1:4627/v1/responses",
            modelName: "azure/gpt-5.6-luna",
            timeout: 30_000,
        });
    });

    it("keeps generic TypeAgent action parameters non-strict", () => {
        const schema = buildTypeAgentFunctionSchema({
            name: "execute_action",
            description: "Execute a schema-validated TypeAgent action",
            inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    action: {
                        type: "object",
                        properties: {
                            parameters: { type: "object" },
                        },
                    },
                },
            },
            handler: async () => ({ content: [] }),
        });

        expect(schema.function.strict).toBeUndefined();
    });

    it("matches the explorer baseline's medium reasoning effort", () => {
        expect(TYPEAGENT_REASONING_COMPLETION_SETTINGS).toEqual({
            reasoning_effort: "medium",
        });
    });

    it("executes typed tools and stops on a successful terminal action", async () => {
        const completions = [
            toolCall("discoverRepository"),
            toolCall("refineRepository"),
            toolCall("submitExploration"),
            toolCall("must-not-run"),
        ];
        const complete = jest.fn<ChatModel["complete"]>(
            async (_prompt, usageCallback) => {
                usageCallback?.({
                    prompt_tokens: 100,
                    completion_tokens: 20,
                    total_tokens: 120,
                    prompt_tokens_details: { cached_tokens: 25 },
                    completion_tokens_details: { reasoning_tokens: 5 },
                } as never);
                return success(completions.shift()!);
            },
        );
        const model = {
            completionSettings: {},
            complete,
        } as unknown as ChatModel;
        const handled: string[] = [];
        const config: ReasoningLoopConfig = {
            model: "azure/gpt-5.6-luna",
            systemPrompt: "Use typed TypeAgent actions.",
            maxTurns: 8,
            tools: [
                {
                    name: "execute_action",
                    description: "Execute a typed action",
                    inputSchema: {
                        type: "object",
                        properties: { action: { type: "object" } },
                        required: ["action"],
                    },
                    handler: async (args) => {
                        const action = args.action as {
                            actionName: string;
                        };
                        handled.push(action.actionName);
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: `${action.actionName}: ok`,
                                },
                            ],
                        };
                    },
                    isTerminal: (args, result) =>
                        !result.isError &&
                        (
                            args.action as {
                                actionName?: string;
                            }
                        )?.actionName === "submitExploration",
                },
            ],
        };

        const session = createTypeAgentReasoningSession(model, config);
        const events = [];
        for await (const event of session.execute("Find the code")) {
            events.push(event);
        }

        expect(handled).toEqual([
            "discoverRepository",
            "refineRepository",
            "submitExploration",
        ]);
        expect(complete).toHaveBeenCalledTimes(3);
        const secondPrompt = JSON.stringify(complete.mock.calls[1]?.[0]);
        const thirdPrompt = JSON.stringify(complete.mock.calls[2]?.[0]);
        expect(secondPrompt).toContain("discoverRepository: ok");
        expect(secondPrompt).not.toContain('"program"');
        expect(thirdPrompt).toContain("discoverRepository: ok");
        expect(thirdPrompt).toContain("refineRepository: ok");
        expect(events.at(-1)).toEqual({
            type: "done",
            result: {
                success: true,
                output: "submitExploration: ok",
            },
        });
        expect(session.getUsage()).toEqual({
            requestCount: 3,
            usageComplete: true,
            inputTokens: 300,
            cachedInputTokens: 75,
            outputTokens: 60,
            reasoningOutputTokens: 15,
            totalTokens: 360,
        });
    });

    it("stops immediately with a failed done event for terminal errors", async () => {
        const complete = jest.fn<ChatModel["complete"]>(async () =>
            success(toolCall("fatal")),
        );
        const model = {
            completionSettings: {},
            complete,
        } as unknown as ChatModel;
        const config: ReasoningLoopConfig = {
            model: "azure/gpt-5.6-luna",
            systemPrompt: "Use typed TypeAgent actions.",
            maxTurns: 8,
            tools: [
                {
                    name: "execute_action",
                    description: "Execute a typed action",
                    inputSchema: { type: "object" },
                    handler: async () => ({
                        content: [
                            {
                                type: "text" as const,
                                text: "repository call budget exhausted",
                            },
                        ],
                        isError: true,
                    }),
                    isTerminal: (_args, result) => result.isError === true,
                },
            ],
        };

        const events = [];
        for await (const event of createTypeAgentReasoningSession(
            model,
            config,
        ).execute("Find the code")) {
            events.push(event);
        }

        expect(complete).toHaveBeenCalledTimes(1);
        expect(events.at(-1)).toEqual({
            type: "done",
            result: {
                success: false,
                error: "repository call budget exhausted",
            },
        });
    });
});

function toolCall(actionName: string): string {
    return JSON.stringify({
        name: "execute_action",
        arguments: {
            action: {
                actionName,
                parameters: { program: "program" },
            },
        },
    });
}
