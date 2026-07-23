// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    openai,
    responses,
    type ChatModel,
    type FunctionCallingJsonSchema,
} from "@typeagent/aiclient";
import { randomUUID } from "node:crypto";
import type { PromptSection } from "typechat";
import type {
    ReasoningEvent,
    ReasoningLoopConfig,
    ReasoningSDKAdapter,
    ReasoningSession,
    ReasoningToolDefinition,
    ToolResult,
} from "./reasoningLoopBase.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export const TYPEAGENT_REASONING_COMPLETION_SETTINGS = {
    reasoning_effort: "medium",
} as const;

export interface TypeAgentReasoningAdapterOptions {
    baseUrl: string;
    apiKey: string;
    requestTimeoutMs?: number;
}

export interface TypeAgentReasoningUsage {
    requestCount: number;
    usageComplete: boolean;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
}

export interface TypeAgentReasoningSession extends ReasoningSession {
    getUsage(): TypeAgentReasoningUsage;
}

/**
 * Runs the shared TypeAgent reasoning loop directly through TypeAgent's AI
 * client. No vendor agent runtime, filesystem tools, memory, or hidden
 * instructions participate in the session.
 */
export class TypeAgentReasoningAdapter implements ReasoningSDKAdapter {
    public constructor(
        private readonly options: TypeAgentReasoningAdapterOptions,
    ) {}

    public async createSession(
        config: ReasoningLoopConfig,
    ): Promise<TypeAgentReasoningSession> {
        const settings = buildTypeAgentResponsesApiSettings(
            this.options.baseUrl,
            this.options.apiKey,
            config.model,
            this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        );
        const model = responses.createResponsesModel(
            settings,
            TYPEAGENT_REASONING_COMPLETION_SETTINGS,
        );
        return createTypeAgentReasoningSession(model, config);
    }
}

export function createTypeAgentReasoningAdapter(
    options: TypeAgentReasoningAdapterOptions,
): TypeAgentReasoningAdapter {
    return new TypeAgentReasoningAdapter(options);
}

export function buildTypeAgentResponsesApiSettings(
    baseUrl: string,
    apiKey: string,
    modelName: string,
    timeout = DEFAULT_REQUEST_TIMEOUT_MS,
): responses.ResponsesApiSettings {
    const url = new URL(baseUrl);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    if (!url.pathname.endsWith("/responses")) {
        url.pathname += "/responses";
    }
    return {
        endpoint: url.toString(),
        apiKey,
        modelName,
        timeout,
        maxRetryAttempts: 1,
    };
}

export function createTypeAgentReasoningSession(
    model: ChatModel,
    config: ReasoningLoopConfig,
): TypeAgentReasoningSession {
    return new NativeTypeAgentReasoningSession(model, config);
}

class NativeTypeAgentReasoningSession implements TypeAgentReasoningSession {
    private readonly usage: TypeAgentReasoningUsage = {
        requestCount: 0,
        usageComplete: true,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
    };

    public constructor(
        private readonly model: ChatModel,
        private readonly config: ReasoningLoopConfig,
    ) {}

    public getSessionId(): undefined {
        return undefined;
    }

    public getUsage(): TypeAgentReasoningUsage {
        return { ...this.usage };
    }

    public async *execute(userMessage: string): AsyncIterable<ReasoningEvent> {
        const tools = new Map(
            this.config.tools.map((tool) => [tool.name, tool] as const),
        );
        const schemas = this.config.tools.map(buildTypeAgentFunctionSchema);
        const history: PromptSection[] = [
            {
                role: "system",
                content:
                    typeof this.config.systemPrompt === "string"
                        ? this.config.systemPrompt
                        : JSON.stringify(this.config.systemPrompt),
            },
            { role: "user", content: userMessage },
        ];

        for (let turn = 0; turn < this.config.maxTurns; turn++) {
            const completion = await this.model.complete(
                history,
                (usage) => addUsage(this.usage, usage),
                schemas,
            );
            if (!completion.success) {
                this.usage.usageComplete = false;
                yield failed(completion.message);
                return;
            }
            const call = parseToolCall(completion.data);
            const tool = tools.get(call.name);
            if (!tool) {
                yield failed(`Unknown reasoning tool: ${call.name}`);
                return;
            }

            const id = randomUUID();
            yield {
                type: "tool_call",
                tool: call.name,
                args: call.arguments,
                id,
            };
            let result: ToolResult;
            try {
                result = await tool.handler(call.arguments);
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                result = {
                    content: [{ type: "text", text: message }],
                    isError: true,
                };
            }
            const text = result.content.map((item) => item.text).join("\n");
            yield {
                type: "tool_result",
                id,
                tool: call.name,
                result: text,
                isError: result.isError === true,
            };
            if (tool.isTerminal?.(call.arguments, result)) {
                yield result.isError
                    ? {
                          type: "done",
                          result: { success: false, error: text },
                      }
                    : {
                          type: "done",
                          result: { success: true, output: text },
                      };
                return;
            }

            history.push(
                {
                    role: "assistant",
                    content: describeToolCall(call.name, call.arguments),
                },
                {
                    role: "user",
                    content: `Tool result${result.isError ? " (error)" : ""}:\n${text}\n\nContinue with the next required typed action.`,
                },
            );
        }

        yield failed(
            `Reasoning loop reached its ${this.config.maxTurns}-turn limit`,
        );
    }
}

export function buildTypeAgentFunctionSchema(
    tool: ReasoningToolDefinition,
): FunctionCallingJsonSchema {
    return {
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema as Record<string, unknown>,
        },
    };
}

function parseToolCall(value: string): {
    name: string;
    arguments: Record<string, unknown>;
} {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error("TypeAgent reasoning returned an invalid tool call");
    }
    if (!isRecord(parsed) || typeof parsed.name !== "string") {
        throw new Error("TypeAgent reasoning tool call is missing its name");
    }
    if (!isRecord(parsed.arguments)) {
        throw new Error(
            `TypeAgent reasoning tool ${parsed.name} is missing its arguments`,
        );
    }
    return { name: parsed.name, arguments: parsed.arguments };
}

function describeToolCall(
    toolName: string,
    args: Record<string, unknown>,
): string {
    const action = isRecord(args.action) ? args.action : args;
    const actionName =
        typeof action?.actionName === "string"
            ? ` for ${action.actionName}`
            : "";
    return `Called ${toolName}${actionName}.`;
}

function addUsage(
    target: TypeAgentReasoningUsage,
    usage: openai.CompletionUsageStats,
): void {
    const details = usage as openai.CompletionUsageStats & {
        prompt_tokens_details?: { cached_tokens?: number };
        completion_tokens_details?: { reasoning_tokens?: number };
        usage_complete?: boolean;
    };
    target.requestCount++;
    target.usageComplete &&= details.usage_complete !== false;
    target.inputTokens += usage.prompt_tokens;
    target.cachedInputTokens +=
        details.prompt_tokens_details?.cached_tokens ?? 0;
    target.outputTokens += usage.completion_tokens;
    target.reasoningOutputTokens +=
        details.completion_tokens_details?.reasoning_tokens ?? 0;
    target.totalTokens = target.inputTokens + target.outputTokens;
}

function failed(error: string): ReasoningEvent {
    return { type: "done", result: { success: false, error } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
