// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Result, success, error } from "typechat";
import type { WireApi } from "@typeagent/config";
import type { ApiSettings, CompletionUsageStats } from "../inferenceClient.js";
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
        const usage = (data as Message).usage;
        return usageFromInputOutput(usage?.input_tokens, usage?.output_tokens);
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
                    piece.usage = usageFromInputOutput(
                        evt.usage.input_tokens ?? undefined,
                        evt.usage.output_tokens,
                    );
                } else if (evt.type === "message_start") {
                    piece.usage = usageFromInputOutput(
                        evt.message.usage.input_tokens,
                        evt.message.usage.output_tokens,
                    );
                }

                return piece;
            },
            finish: () => undefined,
        };
    }
}

export const messagesWireApiProvider = new MessagesWireApiProvider();
