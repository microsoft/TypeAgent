// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * anthropic_messages wire adapter.
 *
 * Anthropic Messages API (`/v1/messages`): x-api-key + anthropic-version
 * auth, system split out of messages, required max_tokens, content blocks
 * in the response.
 */

import { Result, success, error } from "typechat";
import type { WireApi } from "@typeagent/config";
import type { ApiSettings, CompletionUsageStats } from "../openai.js";
import { splitSystemMessages, usageFromInputOutput } from "./shared.js";
import type {
    ModelRequest,
    ProviderAdapter,
    StreamDecoder,
    StreamPiece,
} from "./types.js";

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;

type AnthropicContentBlock =
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | { type: string; [k: string]: unknown };

type AnthropicMessage = {
    content?: AnthropicContentBlock[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
};

export class AnthropicMessagesAdapter implements ProviderAdapter {
    readonly wireApi: WireApi = "anthropic_messages";

    async buildHeaders(
        settings: ApiSettings,
    ): Promise<Result<Record<string, string>>> {
        // Anthropic authenticates with an API key header, not bearer.
        const apiKey = (settings as { apiKey?: string }).apiKey ?? "";
        return success({
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
        });
    }

    buildRequestBody(request: ModelRequest): unknown {
        const { system, turns } = splitSystemMessages(request.messages);
        const cs = request.completionSettings;
        const maxTokens =
            (cs.max_completion_tokens as number | undefined) ??
            (cs.max_tokens as number | undefined) ??
            ANTHROPIC_DEFAULT_MAX_TOKENS;
        const body: Record<string, unknown> = {
            model: request.modelName ?? request.defaultParams.model,
            messages: turns,
            max_tokens: maxTokens,
        };
        if (system) {
            body.system = system;
        }
        if (typeof cs.temperature === "number") {
            body.temperature = cs.temperature;
        }
        if (typeof cs.top_p === "number") {
            body.top_p = cs.top_p;
        }
        if (request.stream) {
            body.stream = true;
        }
        // Function calling → Anthropic tool use.
        if (Array.isArray(request.jsonSchema)) {
            body.tools = request.jsonSchema.map((t) => ({
                name: t.function.name,
                description: t.function.description,
                input_schema: t.function.parameters ?? {
                    type: "object",
                    properties: {},
                },
            }));
            body.tool_choice = { type: "any" };
        }
        return body;
    }

    parseResponse(data: unknown, request: ModelRequest): Result<string> {
        const msg = data as AnthropicMessage;
        const blocks = msg.content ?? [];
        if (Array.isArray(request.jsonSchema)) {
            const toolUse = blocks.find((b) => b.type === "tool_use") as
                | { name: string; input: unknown }
                | undefined;
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
            .filter((b) => b.type === "text")
            .map((b) => (b as { text: string }).text)
            .join("");
        return success(text);
    }

    extractUsage(data: unknown): CompletionUsageStats | undefined {
        const usage = (data as AnthropicMessage).usage;
        return usageFromInputOutput(usage?.input_tokens, usage?.output_tokens);
    }

    createStreamDecoder(): StreamDecoder {
        // Anthropic SSE: content_block_delta { delta: { text } } for text,
        // message_delta { usage } for final token counts. (Tool-use streaming
        // via input_json_delta is out of scope for this reference decoder.)
        return {
            push: (raw: string): StreamPiece => {
                const evt = JSON.parse(raw) as {
                    type?: string;
                    delta?: { type?: string; text?: string };
                    usage?: { input_tokens?: number; output_tokens?: number };
                    message?: {
                        usage?: {
                            input_tokens?: number;
                            output_tokens?: number;
                        };
                    };
                };
                const piece: StreamPiece = {};
                if (
                    evt.type === "content_block_delta" &&
                    evt.delta?.type === "text_delta" &&
                    evt.delta.text
                ) {
                    piece.text = evt.delta.text;
                }
                const usage = evt.usage ?? evt.message?.usage;
                if (usage) {
                    piece.usage = usageFromInputOutput(
                        usage.input_tokens,
                        usage.output_tokens,
                    );
                }
                return piece;
            },
            finish: () => undefined,
        };
    }
}

/** Singleton used by the dispatcher (adapters are stateless). */
export const anthropicMessagesAdapter = new AnthropicMessagesAdapter();
