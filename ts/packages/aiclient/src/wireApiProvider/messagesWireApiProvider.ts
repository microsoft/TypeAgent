// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Result, success, error } from "typechat";
import type { WireApi } from "@typeagent/config";
import type { ApiSettings, CompletionUsageStats } from "../openai.js";
import type { FunctionCallingJsonSchema } from "../models.js";
import {
    createApiHeaders,
    splitSystemMessages,
    usageFromInputOutput,
} from "./shared.js";
import type {
    ModelRequest,
    ProviderAdapter,
    StreamDecoder,
    StreamPiece,
} from "./types.js";
import type {
    Message,
    MessageCreateParamsBase,
    MessageParam,
    Model,
    RawMessageStreamEvent,
    TextBlock,
    TextDelta,
    Tool,
    ToolUseBlock,
} from "./messages.types.js";

function toMessageParams(
    turns: { role: string; content: unknown }[],
): MessageParam[] {
    return turns.map((t) => ({
        role: t.role === "assistant" ? "assistant" : "user",
        content:
            typeof t.content === "string"
                ? t.content
                : JSON.stringify(t.content),
    }));
}

function toTools(schemas: FunctionCallingJsonSchema[]): Tool[] {
    return schemas.map((t) => {
        const parameters = t.function.parameters ?? { properties: {} };
        const input_schema: Tool.InputSchema = {
            ...parameters,
            type: "object",
        };
        const tool: Tool = {
            name: t.function.name,
            input_schema,
        };
        if (t.function.description !== undefined) {
            tool.description = t.function.description;
        }
        return tool;
    });
}

/**
 * Normalize Anthropic Messages usage to OpenAI-style accounting.
 *
 * OpenAI (chat/responses): `prompt_tokens`/`input_tokens` is the full input;
 * `cached_tokens` is a subset of that total (cache reads).
 *
 * Anthropic splits input into three exclusive buckets:
 *   total_input = input_tokens
 *               + cache_creation_input_tokens
 *               + cache_read_input_tokens
 * So we fold creation+read into `prompt_tokens` and surface only cache reads
 * as `cached_tokens` (matching OpenAI's subset semantics).
 */
function usageFromMessagesUsage(
    usage:
        | {
              input_tokens?: number | null;
              output_tokens?: number | null;
              cache_creation_input_tokens?: number | null;
              cache_read_input_tokens?: number | null;
          }
        | null
        | undefined,
): CompletionUsageStats | undefined {
    if (usage == null) {
        return undefined;
    }
    const uncached = usage.input_tokens;
    const output = usage.output_tokens;
    const cacheCreate = usage.cache_creation_input_tokens;
    const cacheRead = usage.cache_read_input_tokens;
    if (
        uncached == null &&
        output == null &&
        cacheCreate == null &&
        cacheRead == null
    ) {
        return undefined;
    }
    // OpenAI-style total input (Anthropic buckets are exclusive, not nested).
    const promptTokens =
        (uncached ?? 0) + (cacheCreate ?? 0) + (cacheRead ?? 0);
    return usageFromInputOutput(
        promptTokens,
        output ?? undefined,
        cacheRead == null ? undefined : cacheRead,
    );
}

export class MessagesWireApiProvider implements ProviderAdapter {
    readonly wireApi: WireApi = "messages";

    buildHeaders(settings: ApiSettings) {
        return createApiHeaders(settings);
    }

    buildRequestBody(request: ModelRequest): MessageCreateParamsBase {
        const { system, turns } = splitSystemMessages(request.messages);
        const cs = request.completionSettings;

        if (cs.max_completion_tokens === undefined) {
            throw new Error(
                "messages wireApi requires completionSettings.max_completion_tokens",
            );
        }

        const body: MessageCreateParamsBase = {
            model: (request.modelName ??
                (typeof request.defaultParams.model === "string"
                    ? request.defaultParams.model
                    : "")) as Model,
            messages: toMessageParams(turns),
            max_tokens: cs.max_completion_tokens,
        };

        if (system) {
            body.system = system;
        }
        if (cs.temperature !== undefined) {
            body.temperature = cs.temperature;
        }
        if (cs.top_p !== undefined) {
            body.top_p = cs.top_p;
        }
        if (request.stream) {
            body.stream = true;
        }
        if (Array.isArray(request.jsonSchema)) {
            body.tools = toTools(request.jsonSchema);
            body.tool_choice = { type: "any" };
        }

        return body;
    }

    parseResponse(data: unknown, request: ModelRequest): Result<string> {
        const msg = data as Message;
        const blocks = msg.content;

        if (Array.isArray(request.jsonSchema)) {
            const toolUse = blocks.find(
                (b): b is ToolUseBlock => b.type === "tool_use",
            );
            if (toolUse === undefined) {
                return error("No tool_use block returned");
            }
            return success(
                JSON.stringify({
                    name: toolUse.name,
                    arguments: toolUse.input,
                }),
            );
        }

        const text = blocks
            .filter((b): b is TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("");
        return success(text);
    }

    extractUsage(data: unknown): CompletionUsageStats | undefined {
        return usageFromMessagesUsage((data as Message).usage);
    }

    createStreamDecoder(): StreamDecoder {
        return {
            push: (raw: string): StreamPiece => {
                const evt = JSON.parse(raw) as RawMessageStreamEvent;
                const piece: StreamPiece = {};

                if (
                    evt.type === "content_block_delta" &&
                    evt.delta.type === "text_delta"
                ) {
                    piece.text = (evt.delta as TextDelta).text;
                }

                if (evt.type === "message_delta") {
                    piece.usage = usageFromMessagesUsage(evt.usage);
                } else if (evt.type === "message_start") {
                    piece.usage = usageFromMessagesUsage(evt.message.usage);
                }

                return piece;
            },
            finish: () => undefined,
        };
    }
}

export const messagesWireApiProvider = new MessagesWireApiProvider();
