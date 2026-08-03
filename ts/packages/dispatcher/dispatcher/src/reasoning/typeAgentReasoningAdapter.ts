// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    openai,
    responses,
    type ChatModel,
    type FunctionCallingJsonSchema,
} from "@typeagent/aiclient";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
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
    trajectoryFile?: string;
}

export interface TypeAgentReasoningTrajectoryOptions {
    file: string;
    invocationIndex?: number;
    redactedValues?: readonly string[];
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
    private readonly trajectoryWriter: TypeAgentTrajectoryWriter | undefined;
    private readonly trajectoryWriters = new Map<
        number,
        TypeAgentTrajectoryWriter
    >();

    public constructor(
        private readonly options: TypeAgentReasoningAdapterOptions,
    ) {
        this.trajectoryWriter = options.trajectoryFile
            ? new TypeAgentTrajectoryWriter(options.trajectoryFile, undefined, [
                  options.apiKey,
              ])
            : undefined;
        if (this.trajectoryWriter) {
            this.trajectoryWriters.set(0, this.trajectoryWriter);
        }
    }

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
        const invocationIndex = config.trajectoryInvocationIndex ?? 0;
        let trajectoryWriter = this.trajectoryWriters.get(invocationIndex);
        if (!trajectoryWriter && this.options.trajectoryFile) {
            trajectoryWriter = new TypeAgentTrajectoryWriter(
                trajectoryFileForInvocation(
                    this.options.trajectoryFile,
                    invocationIndex,
                ),
                config.model,
                [this.options.apiKey],
            );
            this.trajectoryWriters.set(invocationIndex, trajectoryWriter);
        }
        return new NativeTypeAgentReasoningSession(
            model,
            config,
            trajectoryWriter,
        );
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
    trajectory?: TypeAgentReasoningTrajectoryOptions,
): TypeAgentReasoningSession {
    return new NativeTypeAgentReasoningSession(
        model,
        config,
        trajectory
            ? new TypeAgentTrajectoryWriter(
                  trajectoryFileForInvocation(
                      trajectory.file,
                      trajectory.invocationIndex ?? 0,
                  ),
                  config.model,
                  trajectory.redactedValues ?? [],
              )
            : undefined,
    );
}

export function trajectoryFileForInvocation(
    file: string,
    invocationIndex: number,
): string {
    if (!Number.isSafeInteger(invocationIndex) || invocationIndex < 0) {
        throw new Error(
            "Trajectory invocation index must be a non-negative integer",
        );
    }
    if (invocationIndex === 0) {
        return file;
    }
    const extension = path.extname(file);
    return path.join(
        path.dirname(file),
        `${path.basename(file, extension)}-invocation-${invocationIndex + 1}${extension}`,
    );
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
        private readonly trajectory?: TypeAgentTrajectoryWriter,
    ) {}

    public getSessionId(): undefined {
        return undefined;
    }

    public getUsage(): TypeAgentReasoningUsage {
        return { ...this.usage };
    }

    public async *execute(userMessage: string): AsyncIterable<ReasoningEvent> {
        const trajectory = this.trajectory;
        trajectory?.setModel(this.config.model);
        const tools = new Map(
            this.config.tools.map((tool) => [tool.name, tool] as const),
        );
        const schemas = this.config.tools.map(buildTypeAgentFunctionSchema);
        let history: PromptSection[] = [
            {
                role: "system",
                content:
                    typeof this.config.systemPrompt === "string"
                        ? this.config.systemPrompt
                        : JSON.stringify(this.config.systemPrompt),
            },
            { role: "user", content: userMessage },
        ];
        let failedRepairHistoryStart: number | undefined;

        await trajectory?.write({
            role: "system",
            content: history[0].content,
        });
        await trajectory?.write({
            role: "user",
            content: userMessage,
        });

        for (let turn = 0; turn < this.config.maxTurns; turn++) {
            const requestIndex = trajectory?.nextRequestIndex() ?? turn + 1;
            const requestUsage = emptyRequestUsage();
            const requestStartedMs = Date.now();
            this.usage.requestCount++;
            let completion: Awaited<ReturnType<ChatModel["complete"]>>;
            try {
                completion = await this.model.complete(
                    history,
                    (usage) => {
                        addUsage(this.usage, usage);
                        addRequestUsage(requestUsage, usage);
                    },
                    schemas,
                );
            } catch (error) {
                requestUsage.durationMs = Math.max(
                    0,
                    Date.now() - requestStartedMs,
                );
                this.usage.usageComplete = false;
                await trajectory?.write({
                    role: "assistant",
                    content:
                        error instanceof Error ? error.message : String(error),
                    usage: requestUsage,
                    requestIndex,
                    sourceEvent: "model.error",
                });
                throw error;
            }
            requestUsage.durationMs = Math.max(
                0,
                Date.now() - requestStartedMs,
            );
            if (!completion.success) {
                this.usage.usageComplete = false;
                await trajectory?.write({
                    role: "assistant",
                    content: completion.message,
                    usage: requestUsage,
                    requestIndex,
                    sourceEvent: "model.error",
                });
                yield failed(completion.message);
                return;
            }
            let call: ReturnType<typeof parseToolCall>;
            try {
                call = parseToolCall(completion.data);
            } catch (error) {
                await trajectory?.write({
                    role: "assistant",
                    content: completion.data,
                    usage: requestUsage,
                    requestIndex,
                    sourceEvent: "model.invalid_tool_call",
                });
                throw error;
            }
            const tool = tools.get(call.name);
            if (!tool) {
                const id = randomUUID();
                const message = `Unknown reasoning tool: ${call.name}`;
                await trajectory?.write({
                    role: "assistant",
                    content: "",
                    tool_calls: [
                        {
                            id,
                            type: "function",
                            function: {
                                name: call.name,
                                arguments: call.arguments,
                            },
                        },
                    ],
                    usage: requestUsage,
                    requestIndex,
                    sourceEvent: "model.unknown_tool_call",
                });
                await trajectory?.write({
                    role: "tool",
                    content: message,
                    tool_call_id: id,
                    isError: true,
                    sourceEvent: "tool.result",
                });
                yield failed(message);
                return;
            }

            const id = randomUUID();
            await trajectory?.write({
                role: "assistant",
                content: "",
                tool_calls: [
                    {
                        id,
                        type: "function",
                        function: {
                            name: call.name,
                            arguments: call.arguments,
                        },
                    },
                ],
                usage: requestUsage,
                requestIndex,
                sourceEvent: "model.tool_call",
            });
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
            await trajectory?.write({
                role: "tool",
                content: text,
                tool_call_id: id,
                isError: result.isError === true,
                sourceEvent: "tool.result",
            });
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

            if (result.isError === true) {
                failedRepairHistoryStart ??= history.length;
            } else if (failedRepairHistoryStart !== undefined) {
                history = history.slice(0, failedRepairHistoryStart);
                failedRepairHistoryStart = undefined;
            }

            history.push(
                {
                    role: "assistant",
                    content: describeToolCall(
                        call.name,
                        call.arguments,
                        result.isError === true,
                    ),
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

interface TypeAgentTrajectoryToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
}

interface TypeAgentTrajectoryUsage {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
    durationMs?: number;
}

interface TypeAgentTrajectoryInput {
    role: "system" | "user" | "assistant" | "tool";
    content: unknown;
    tool_call_id?: string | null;
    tool_calls?: TypeAgentTrajectoryToolCall[];
    usage?: TypeAgentTrajectoryUsage;
    requestIndex?: number;
    isError?: boolean;
    sourceEvent?: string;
}

class TypeAgentTrajectoryWriter {
    private sequence = 0;
    private requestIndex = 0;
    private initialized = false;
    private writeQueue: Promise<void> = Promise.resolve();
    public constructor(
        private readonly file: string,
        private model: string | undefined,
        private readonly redactedValues: readonly string[],
    ) {}

    public setModel(model: string): void {
        if (this.model && this.model !== model) {
            throw new Error(
                `Trajectory model changed from ${this.model} to ${model}`,
            );
        }
        this.model = model;
    }

    public nextRequestIndex(): number {
        return ++this.requestIndex;
    }

    public async write(input: TypeAgentTrajectoryInput): Promise<void> {
        this.writeQueue = this.writeQueue.then(() => this.writeRecord(input));
        await this.writeQueue;
    }

    private async writeRecord(input: TypeAgentTrajectoryInput): Promise<void> {
        if (!this.model) {
            throw new Error("Trajectory model is not initialized");
        }
        const record = redactDeep(
            {
                schemaVersion: 1,
                sequence: ++this.sequence,
                role: input.role,
                content:
                    typeof input.content === "string"
                        ? input.content
                        : JSON.stringify(input.content),
                model: this.model,
                tool_call_id: input.tool_call_id ?? null,
                tool_calls: input.tool_calls ?? [],
                usage: input.usage ?? {},
                source: "typeagent-codemode",
                ...(input.requestIndex !== undefined
                    ? { requestIndex: input.requestIndex }
                    : {}),
                ...(input.isError !== undefined
                    ? { isError: input.isError }
                    : {}),
                ...(input.sourceEvent
                    ? { sourceEvent: input.sourceEvent }
                    : {}),
            },
            this.redactedValues,
        );
        const line = `${JSON.stringify(record)}\n`;
        if (!this.initialized) {
            await mkdir(path.dirname(this.file), { recursive: true });
            await writeFile(this.file, line, {
                encoding: "utf8",
                flag: "wx",
                mode: 0o600,
            });
            this.initialized = true;
            return;
        }
        await appendFile(this.file, line, "utf8");
    }
}

function emptyRequestUsage(): TypeAgentTrajectoryUsage {
    return {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
    };
}

function addRequestUsage(
    target: TypeAgentTrajectoryUsage,
    usage: openai.CompletionUsageStats,
): void {
    const details = usage as openai.CompletionUsageStats & {
        prompt_tokens_details?: { cached_tokens?: number };
        completion_tokens_details?: { reasoning_tokens?: number };
    };
    target.inputTokens += usage.prompt_tokens;
    target.cachedInputTokens +=
        details.prompt_tokens_details?.cached_tokens ?? 0;
    target.outputTokens += usage.completion_tokens;
    target.reasoningOutputTokens +=
        details.completion_tokens_details?.reasoning_tokens ?? 0;
    target.totalTokens = target.inputTokens + target.outputTokens;
}

function redactDeep<T>(value: T, secrets: readonly string[]): T {
    if (typeof value === "string") {
        let redacted = String(value);
        for (const secret of secrets) {
            if (secret) {
                redacted = redacted.split(secret).join("[REDACTED]");
            }
        }
        return redacted as T;
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactDeep(item, secrets)) as T;
    }
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                redactDeep(key, secrets),
                redactDeep(item, secrets),
            ]),
        ) as T;
    }
    return value;
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
            ...(tool.strict ? { strict: true } : {}),
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
    includeArguments: boolean,
): string {
    const action = isRecord(args.action) ? args.action : args;
    const actionName =
        typeof action?.actionName === "string"
            ? ` for ${action.actionName}`
            : "";
    const summary = `Called ${toolName}${actionName}`;
    return includeArguments
        ? `${summary} with arguments:\n${JSON.stringify(args)}`
        : `${summary} successfully.`;
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
