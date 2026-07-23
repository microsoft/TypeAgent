// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    type ChatModel,
    type CompletionJsonSchema,
    type CompletionSettings,
    type FunctionCallingJsonSchema,
} from "./models.js";
import type { CompletionUsageStats } from "./openai.js";
import { TokenCounter } from "./tokenCounter.js";
import { error, type PromptSection, type Result, success } from "typechat";

export interface ResponsesApiSettings {
    endpoint: string;
    apiKey: string;
    modelName: string;
    timeout?: number;
    maxRetryAttempts?: number;
}

export interface ResponsesUsageStats extends CompletionUsageStats {
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
    usage_complete?: boolean;
}

interface ResponsesPayload {
    output?: Array<{
        type: string;
        name?: string;
        arguments?: string;
        content?: Array<{ type?: string; text?: string }>;
    }>;
    output_text?: string;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
        output_tokens_details?: { reasoning_tokens?: number };
    };
    usage_complete?: boolean;
}

/**
 * Creates a TypeAgent ChatModel backed by OpenAI's Responses API. This is the
 * reasoning-capable path for GPT-5 function tools, which Azure rejects on Chat
 * Completions.
 */
export function createResponsesModel(
    settings: ResponsesApiSettings,
    completionSettings: CompletionSettings = {},
): ChatModel {
    return {
        completionSettings,
        complete: async (prompt, usageCallback, jsonSchema, _log, signal) => {
            const request = buildRequest(
                settings.modelName,
                prompt,
                completionSettings,
                jsonSchema,
            );
            const response = await callResponses(settings, request, signal);
            if (!response.success) {
                return response;
            }
            const usage = normalizeUsage(
                response.data.usage,
                response.data.usage_complete !== false,
            );
            TokenCounter.getInstance().add(usage);
            usageCallback?.(usage);
            return parseOutput(response.data, Array.isArray(jsonSchema));
        },
    };
}

function buildRequest(
    model: string,
    prompt: string | PromptSection[],
    completionSettings: CompletionSettings,
    jsonSchema?: CompletionJsonSchema,
): Record<string, unknown> {
    const request: Record<string, unknown> = {
        model,
        input: normalizePrompt(prompt),
        store: false,
    };
    if (completionSettings.reasoning_effort) {
        request.reasoning = { effort: completionSettings.reasoning_effort };
    }
    if (completionSettings.max_completion_tokens !== undefined) {
        request.max_output_tokens = completionSettings.max_completion_tokens;
    }
    if (Array.isArray(jsonSchema)) {
        request.tools = jsonSchema.map(toResponsesTool);
        request.tool_choice = "required";
        request.parallel_tool_calls = false;
    } else if (jsonSchema) {
        request.text = {
            format: {
                type: "json_schema",
                name: jsonSchema.name,
                schema: jsonSchema.schema,
                ...(jsonSchema.description
                    ? { description: jsonSchema.description }
                    : {}),
                ...(jsonSchema.strict ? { strict: true } : {}),
            },
        };
    }
    return request;
}

function normalizePrompt(
    prompt: string | PromptSection[],
): Array<{ role: PromptSection["role"]; content: string }> {
    const sections: PromptSection[] =
        typeof prompt === "string"
            ? [{ role: "user", content: prompt }]
            : prompt;
    return sections.map((section) => ({
        role: section.role,
        content:
            typeof section.content === "string"
                ? section.content
                : JSON.stringify(section.content),
    }));
}

function toResponsesTool(schema: FunctionCallingJsonSchema): {
    type: "function";
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: true;
} {
    return {
        type: "function",
        name: schema.function.name,
        ...(schema.function.description
            ? { description: schema.function.description }
            : {}),
        ...(schema.function.parameters
            ? { parameters: schema.function.parameters }
            : {}),
        ...(schema.function.strict ? { strict: true } : {}),
    };
}

async function callResponses(
    settings: ResponsesApiSettings,
    request: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<Result<ResponsesPayload>> {
    const maxAttempts = Math.max(1, (settings.maxRetryAttempts ?? 0) + 1);
    const deadline = Date.now() + (settings.timeout ?? 300_000);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (signal?.aborted) {
            return error(describeRequestError(signal.reason));
        }
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            return error("Responses request timed out");
        }
        const controller = new AbortController();
        const abort = () => controller.abort(signal?.reason);
        signal?.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(
            () => controller.abort(new Error("Responses request timed out")),
            remainingMs,
        );
        try {
            const response = await fetch(settings.endpoint, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${settings.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(request),
                signal: controller.signal,
            });
            if (!response.ok) {
                const message = (await response.text()).slice(0, 4_000);
                if (
                    attempt + 1 < maxAttempts &&
                    Date.now() < deadline &&
                    (response.status === 429 || response.status >= 500)
                ) {
                    continue;
                }
                return error(
                    `Responses request failed (${response.status}): ${message || response.statusText}`,
                );
            }
            const payload = (await response.json()) as ResponsesPayload;
            payload.usage_complete = attempt === 0;
            return success(payload);
        } catch (requestError) {
            if (
                signal?.aborted ||
                Date.now() >= deadline ||
                attempt + 1 >= maxAttempts
            ) {
                return error(describeRequestError(requestError));
            }
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", abort);
        }
    }
    return error("Responses request failed");
}

function describeRequestError(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
}

function normalizeUsage(
    usage: ResponsesPayload["usage"],
    usageComplete: boolean,
): ResponsesUsageStats {
    if (!usage) {
        return {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            usage_complete: false,
        };
    }
    const promptTokens = usage.input_tokens ?? 0;
    const completionTokens = usage.output_tokens ?? 0;
    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: usage.total_tokens ?? promptTokens + completionTokens,
        usage_complete:
            usageComplete &&
            usage.input_tokens !== undefined &&
            usage.output_tokens !== undefined,
        ...(usage.input_tokens_details
            ? { prompt_tokens_details: usage.input_tokens_details }
            : {}),
        ...(usage.output_tokens_details
            ? { completion_tokens_details: usage.output_tokens_details }
            : {}),
    };
}

function parseOutput(
    response: ResponsesPayload,
    requiresTool: boolean,
): Result<string> {
    const call = response.output?.find((item) => item.type === "function_call");
    if (call?.name && call.arguments) {
        try {
            return success(
                JSON.stringify({
                    name: call.name,
                    arguments: JSON.parse(call.arguments),
                }),
            );
        } catch {
            return error("Responses function call returned invalid arguments");
        }
    }
    if (requiresTool) {
        return error("Responses API returned no function call");
    }
    const text =
        response.output_text ??
        response.output
            ?.flatMap((item) =>
                item.type === "message" ? (item.content ?? []) : [],
            )
            .filter((item) => item.type === "output_text")
            .map((item) => item.text ?? "")
            .join("") ??
        "";
    return text ? success(text) : error("Responses API returned no text");
}
