// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest } from "@jest/globals";
import type { ChatModel } from "@typeagent/aiclient";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { success } from "typechat";
import type { ReasoningLoopConfig } from "../src/reasoning/reasoningLoopBase.js";
import {
    buildTypeAgentFunctionSchema,
    buildTypeAgentResponsesApiSettings,
    createTypeAgentReasoningSession,
    trajectoryFileForInvocation,
    TypeAgentReasoningAdapter,
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

    it("preserves an opt-in strict TypeAgent function schema", () => {
        const schema = buildTypeAgentFunctionSchema({
            name: "execute_action",
            description: "Execute one closed typed action",
            strict: true,
            inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: { value: { type: "string" } },
                required: ["value"],
            },
            handler: async () => ({ content: [] }),
        });

        expect(schema.function.strict).toBe(true);
    });

    it("matches the explorer baseline's medium reasoning effort", () => {
        expect(TYPEAGENT_REASONING_COMPLETION_SETTINGS).toEqual({
            reasoning_effort: "medium",
        });
    });

    it("persists every Code Mode message as normalized JSONL", async () => {
        const directory = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-reasoning-trajectory-"),
        );
        const trajectoryFile = path.join(directory, "codemode.jsonl");
        try {
            const complete = jest.fn<ChatModel["complete"]>(
                async (_prompt, usageCallback) => {
                    usageCallback?.({
                        prompt_tokens: 100,
                        completion_tokens: 20,
                        total_tokens: 120,
                        prompt_tokens_details: { cached_tokens: 25 },
                        completion_tokens_details: { reasoning_tokens: 5 },
                    } as never);
                    return success(
                        JSON.stringify({
                            name: "execute_action",
                            arguments: {
                                "secret-key": "visible",
                                action: {
                                    actionName: "submitExploration",
                                    parameters: { program: "secret" },
                                },
                            },
                        }),
                    );
                },
            );
            const model = {
                completionSettings: {},
                complete,
            } as unknown as ChatModel;
            const config: ReasoningLoopConfig = {
                model: "azure/gpt-5.6-luna",
                systemPrompt: "Use typed TypeAgent actions.",
                maxTurns: 1,
                tools: [
                    {
                        name: "execute_action",
                        description: "Execute a typed action",
                        inputSchema: { type: "object" },
                        handler: async () => ({
                            content: [
                                {
                                    type: "text" as const,
                                    text: "submitted secret",
                                },
                            ],
                        }),
                        isTerminal: () => true,
                    },
                ],
            };

            for await (const _event of createTypeAgentReasoningSession(
                model,
                config,
                {
                    file: trajectoryFile,
                    redactedValues: ["secret"],
                },
            ).execute("Find secret code")) {
                // Consume the complete session.
            }

            const text = await readFile(trajectoryFile, "utf8");
            const records = text
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            expect(records.map((record) => record.role)).toEqual([
                "system",
                "user",
                "assistant",
                "tool",
            ]);
            expect(records.map((record) => record.sequence)).toEqual([
                1, 2, 3, 4,
            ]);
            expect(
                records.every(
                    (record) =>
                        record.schemaVersion === 1 &&
                        record.model === "azure/gpt-5.6-luna" &&
                        Array.isArray(record.tool_calls) &&
                        typeof record.usage === "object",
                ),
            ).toBe(true);
            expect(records[2].tool_calls[0].id).toBe(records[3].tool_call_id);
            expect(records[2].requestIndex).toBe(1);
            expect(records[2].usage).toEqual({
                inputTokens: 100,
                cachedInputTokens: 25,
                outputTokens: 20,
                reasoningOutputTokens: 5,
                totalTokens: 120,
                durationMs: expect.any(Number),
            });
            expect(text).not.toContain("secret");
            expect(text).toContain("[REDACTED]");
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("serializes concurrent writes through one adapter trajectory", async () => {
        const directory = await mkdtemp(
            path.join(
                os.tmpdir(),
                "typeagent-reasoning-concurrent-trajectory-",
            ),
        );
        const trajectoryFile = path.join(directory, "codemode.jsonl");
        try {
            const adapter = new TypeAgentReasoningAdapter({
                baseUrl: "http://127.0.0.1:1/v1",
                apiKey: "not-logged",
                trajectoryFile,
            });
            const writer = (
                adapter as unknown as {
                    trajectoryWriter: {
                        setModel(model: string): void;
                        write(input: {
                            role: "user";
                            content: string;
                        }): Promise<void>;
                    };
                }
            ).trajectoryWriter;
            writer.setModel("azure/gpt-5.6-luna");

            await Promise.all(
                Array.from({ length: 40 }, (_, index) =>
                    writer.write({ role: "user", content: `message-${index}` }),
                ),
            );

            const records = (await readFile(trajectoryFile, "utf8"))
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            expect(records).toHaveLength(40);
            expect(records.map((record) => record.sequence)).toEqual(
                Array.from({ length: 40 }, (_, index) => index + 1),
            );
            expect(new Set(records.map((record) => record.content)).size).toBe(
                40,
            );
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("uses a separate deterministic trajectory file for each invocation", () => {
        const first = "/runs/typeagent-codemode-row-luna.jsonl";

        expect(trajectoryFileForInvocation(first, 0)).toBe(first);
        expect(trajectoryFileForInvocation(first, 1)).toBe(
            "/runs/typeagent-codemode-row-luna-invocation-2.jsonl",
        );
        expect(() => trajectoryFileForInvocation(first, -1)).toThrow(
            /non-negative integer/i,
        );
    });

    it("records an assistant failure when a Code Mode model request throws", async () => {
        const directory = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-reasoning-failure-"),
        );
        const trajectoryFile = path.join(directory, "codemode.jsonl");
        try {
            const complete = jest.fn<ChatModel["complete"]>(async () => {
                throw new Error("provider secret failure");
            });
            const model = {
                completionSettings: {},
                complete,
            } as unknown as ChatModel;
            const config: ReasoningLoopConfig = {
                model: "azure/gpt-5.6-luna",
                systemPrompt: "Use typed TypeAgent actions.",
                maxTurns: 1,
                tools: [],
            };
            const execute = async () => {
                for await (const _event of createTypeAgentReasoningSession(
                    model,
                    config,
                    {
                        file: trajectoryFile,
                        redactedValues: ["secret"],
                    },
                ).execute("Find the code")) {
                    // Consume the failed session.
                }
            };

            await expect(execute()).rejects.toThrow("provider secret failure");
            const text = await readFile(trajectoryFile, "utf8");
            const records = text
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            expect(records.map((record) => record.role)).toEqual([
                "system",
                "user",
                "assistant",
            ]);
            expect(records[2]).toMatchObject({
                content: "provider [REDACTED] failure",
                requestIndex: 1,
                sourceEvent: "model.error",
                usage: {
                    inputTokens: 0,
                    cachedInputTokens: 0,
                    outputTokens: 0,
                    reasoningOutputTokens: 0,
                    totalTokens: 0,
                },
            });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("persists every multi-turn repair message with one usage record per request", async () => {
        const directory = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-reasoning-repair-trajectory-"),
        );
        const trajectoryFile = path.join(directory, "codemode.jsonl");
        try {
            const completions = [
                toolCall("discoverRepository"),
                toolCall("submitExploration", "invalid-range"),
                toolCall("submitExploration", "repaired-range"),
            ];
            let request = 0;
            const complete = jest.fn<ChatModel["complete"]>(
                async (_prompt, usageCallback) => {
                    request++;
                    usageCallback?.({
                        prompt_tokens: request * 10,
                        completion_tokens: request * 2,
                        total_tokens: request * 12,
                        prompt_tokens_details: { cached_tokens: request },
                        completion_tokens_details: {
                            reasoning_tokens: request,
                        },
                    } as never);
                    return success(completions.shift()!);
                },
            );
            const model = {
                completionSettings: {},
                complete,
            } as unknown as ChatModel;
            let toolAttempt = 0;
            const config: ReasoningLoopConfig = {
                model: "azure/gpt-5.6-luna",
                systemPrompt: "Use typed TypeAgent actions.",
                maxTurns: 3,
                tools: [
                    {
                        name: "execute_action",
                        description: "Execute a typed action",
                        inputSchema: { type: "object" },
                        handler: async () => {
                            toolAttempt++;
                            if (toolAttempt === 2) {
                                return {
                                    content: [
                                        {
                                            type: "text" as const,
                                            text: "range is not grounded",
                                        },
                                    ],
                                    isError: true,
                                };
                            }
                            return {
                                content: [
                                    {
                                        type: "text" as const,
                                        text:
                                            toolAttempt === 1
                                                ? "discovery evidence"
                                                : "submitted repaired location",
                                    },
                                ],
                            };
                        },
                        isTerminal: (args, result) =>
                            result.isError !== true &&
                            (
                                args.action as {
                                    actionName?: string;
                                }
                            )?.actionName === "submitExploration",
                    },
                ],
            };

            for await (const _event of createTypeAgentReasoningSession(
                model,
                config,
                { file: trajectoryFile },
            ).execute("Find the code")) {
                // Consume discovery, failed submission, and repaired submission.
            }

            const records = (await readFile(trajectoryFile, "utf8"))
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            expect(records.map((record) => record.role)).toEqual([
                "system",
                "user",
                "assistant",
                "tool",
                "assistant",
                "tool",
                "assistant",
                "tool",
            ]);
            expect(records.map((record) => record.sequence)).toEqual([
                1, 2, 3, 4, 5, 6, 7, 8,
            ]);
            expect(
                records.every((record) =>
                    [
                        "role",
                        "content",
                        "model",
                        "tool_call_id",
                        "tool_calls",
                        "usage",
                    ].every((field) =>
                        Object.prototype.hasOwnProperty.call(record, field),
                    ),
                ),
            ).toBe(true);

            const assistantRecords = records.filter(
                (record) => record.role === "assistant",
            );
            expect(
                assistantRecords.map((record) => record.requestIndex),
            ).toEqual([1, 2, 3]);
            expect(assistantRecords.map((record) => record.usage)).toEqual([
                {
                    inputTokens: 10,
                    cachedInputTokens: 1,
                    outputTokens: 2,
                    reasoningOutputTokens: 1,
                    totalTokens: 12,
                    durationMs: expect.any(Number),
                },
                {
                    inputTokens: 20,
                    cachedInputTokens: 2,
                    outputTokens: 4,
                    reasoningOutputTokens: 2,
                    totalTokens: 24,
                    durationMs: expect.any(Number),
                },
                {
                    inputTokens: 30,
                    cachedInputTokens: 3,
                    outputTokens: 6,
                    reasoningOutputTokens: 3,
                    totalTokens: 36,
                    durationMs: expect.any(Number),
                },
            ]);
            expect(
                records.filter(
                    (record) => Object.keys(record.usage).length > 0,
                ),
            ).toHaveLength(3);

            const toolCalls = assistantRecords.flatMap(
                (record) => record.tool_calls,
            );
            const toolResults = records.filter(
                (record) => record.role === "tool",
            );
            expect(toolResults.map((record) => record.tool_call_id)).toEqual(
                toolCalls.map((call) => call.id),
            );
            expect(new Set(toolCalls.map((call) => call.id)).size).toBe(3);
            expect(toolResults.map((record) => record.content)).toEqual([
                "discovery evidence",
                "range is not grounded",
                "submitted repaired location",
            ]);
            expect(toolResults.map((record) => record.isError)).toEqual([
                false,
                true,
                false,
            ]);
            expect(complete).toHaveBeenCalledTimes(3);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
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
        expect(secondPrompt).toContain(
            "Called execute_action for discoverRepository",
        );
        expect(secondPrompt).not.toContain(
            '\\"program\\":\\"successful-program-must-not-replay\\"',
        );
        expect(thirdPrompt).toContain("discoverRepository: ok");
        expect(thirdPrompt).toContain("refineRepository: ok");
        expect(thirdPrompt).toContain(
            "Called execute_action for refineRepository",
        );
        expect(thirdPrompt).not.toContain(
            '\\"program\\":\\"successful-program-must-not-replay\\"',
        );
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

    it("retains failed tool arguments for the next repair turn", async () => {
        const completions = [
            toolCall("discoverRepository", "failed-program-must-replay"),
            toolCall("submitExploration"),
        ];
        const complete = jest.fn<ChatModel["complete"]>(async () =>
            success(completions.shift()!),
        );
        const model = {
            completionSettings: {},
            complete,
        } as unknown as ChatModel;
        let attempts = 0;
        const config: ReasoningLoopConfig = {
            model: "azure/gpt-5.6-luna",
            systemPrompt: "Use typed TypeAgent actions.",
            maxTurns: 3,
            tools: [
                {
                    name: "execute_action",
                    description: "Execute a typed action",
                    inputSchema: { type: "object" },
                    handler: async () => {
                        attempts++;
                        return attempts === 1
                            ? {
                                  content: [
                                      {
                                          type: "text" as const,
                                          text: "repair the failed program",
                                      },
                                  ],
                                  isError: true,
                              }
                            : {
                                  content: [
                                      {
                                          type: "text" as const,
                                          text: "submitted",
                                      },
                                  ],
                              };
                    },
                    isTerminal: (args, result) =>
                        result.isError !== true &&
                        (
                            args.action as {
                                actionName?: string;
                            }
                        )?.actionName === "submitExploration",
                },
            ],
        };

        for await (const _event of createTypeAgentReasoningSession(
            model,
            config,
        ).execute("Find the code")) {
            // Consume the complete session.
        }

        expect(complete).toHaveBeenCalledTimes(2);
        const repairPrompt = JSON.stringify(complete.mock.calls[1]?.[0]);
        expect(repairPrompt).toContain("failed-program-must-replay");
        expect(repairPrompt).toContain("repair the failed program");
    });

    it("removes failed repair context after the action succeeds", async () => {
        const completions = [
            toolCall("discoverRepository"),
            toolCall("refineRepository", "stale-failed-program"),
            toolCall("refineRepository", "repaired-program"),
            toolCall("submitExploration"),
        ];
        const complete = jest.fn<ChatModel["complete"]>(async () =>
            success(completions.shift()!),
        );
        const model = {
            completionSettings: {},
            complete,
        } as unknown as ChatModel;
        const config: ReasoningLoopConfig = {
            model: "azure/gpt-5.6-luna",
            systemPrompt: "Use typed TypeAgent actions.",
            maxTurns: 5,
            tools: [
                {
                    name: "execute_action",
                    description: "Execute a typed action",
                    inputSchema: { type: "object" },
                    handler: async (args) => {
                        const action = args.action as {
                            actionName: string;
                            parameters?: { program?: string };
                        };
                        if (
                            action.actionName === "refineRepository" &&
                            action.parameters?.program ===
                                "stale-failed-program"
                        ) {
                            return {
                                content: [
                                    {
                                        type: "text" as const,
                                        text: "candidate visibility failure",
                                    },
                                ],
                                isError: true,
                            };
                        }
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text:
                                        action.parameters?.program ===
                                        "repaired-program"
                                            ? "grounded repaired evidence"
                                            : `${action.actionName}: ok`,
                                },
                            ],
                        };
                    },
                    isTerminal: (args, result) =>
                        result.isError !== true &&
                        (
                            args.action as {
                                actionName?: string;
                            }
                        )?.actionName === "submitExploration",
                },
            ],
        };

        for await (const _event of createTypeAgentReasoningSession(
            model,
            config,
        ).execute("Find the code")) {
            // Consume the complete session.
        }

        expect(complete).toHaveBeenCalledTimes(4);
        const repairPrompt = JSON.stringify(complete.mock.calls[2]?.[0]);
        expect(repairPrompt).toContain("stale-failed-program");
        expect(repairPrompt).toContain("candidate visibility failure");

        const submissionPrompt = JSON.stringify(complete.mock.calls[3]?.[0]);
        expect(submissionPrompt).toContain("grounded repaired evidence");
        expect(submissionPrompt).not.toContain("stale-failed-program");
        expect(submissionPrompt).not.toContain("candidate visibility failure");
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

function toolCall(
    actionName: string,
    program = "successful-program-must-not-replay",
): string {
    return JSON.stringify({
        name: "execute_action",
        arguments: {
            action: {
                actionName,
                parameters: { program },
            },
        },
    });
}
