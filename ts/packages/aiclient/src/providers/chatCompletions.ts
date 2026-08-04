// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * chat_completions wire adapter — the default.
 *
 * OpenAI / Azure OpenAI Chat Completions API (`/chat/completions`).
 * Faithful extraction of the request/response logic that lived inline in
 * createAzureOpenAIChatModel, so the default path is byte-identical to
 * before adapters existed.
 */

import { Result, success, error } from "typechat";
import type { WireApi } from "@typeagent/config";
import type { ApiSettings, CompletionUsageStats } from "../openai.js";
import {
    createApiHeaders,
    verifyFilterResults,
    type FilterError,
    type FilterResult,
} from "./shared.js";
import type {
    ModelRequest,
    ProviderAdapter,
    StreamDecoder,
    StreamPiece,
} from "./types.js";

type ToolCall = {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
};

type ChatContent<ToolCallType = ToolCall> = {
    content?: string | null;
    tool_calls?: ToolCallType[];
    role: "assistant";
};

type ChatCompletionChoice = {
    message?: ChatContent;
    content_filter_results?: FilterResult | FilterError;
    finish_reason?: string;
};

type ChatCompletion = {
    id: string;
    choices: ChatCompletionChoice[];
    usage: CompletionUsageStats;
};

type ToolCallDelta = { index: number } & ToolCall;

type ChatCompletionDelta = {
    delta: ChatContent<ToolCallDelta>;
    content_filter_results?: FilterResult | FilterError;
    finish_reason?: string;
};

type ChatCompletionChunk = {
    id: string;
    choices: ChatCompletionDelta[];
    usage?: CompletionUsageStats;
};

/** Throw on any content-filter violation in a chat completion chunk. */
function verifyStreamContentSafety(data: ChatCompletionChunk): void {
    data.choices.map((c: ChatCompletionDelta) => {
        if (c.finish_reason === "content_filter_error") {
            const err = c.content_filter_results as FilterError;
            throw new Error(
                `There was a content filter error (${err.code}): ${err.message}`,
            );
        }
        verifyFilterResults(c.content_filter_results as FilterResult);
    });
}

export class ChatCompletionsAdapter implements ProviderAdapter {
    readonly wireApi: WireApi = "chat_completions";

    buildHeaders(settings: ApiSettings) {
        return createApiHeaders(settings);
    }

    buildRequestBody(request: ModelRequest): unknown {
        const params: any = {
            ...request.defaultParams,
            messages: request.messages,
            ...request.completionSettings,
            ...(request.stream
                ? { stream: true, stream_options: request.streamOptions }
                : {}),
        };
        const jsonSchema = request.jsonSchema;
        if (jsonSchema !== undefined) {
            if (request.disableResponseFormat) {
                throw new Error(
                    `Json schema not supported by model '${request.modelName}'`,
                );
            }
            if (Array.isArray(jsonSchema)) {
                // function calling
                params.tools = jsonSchema;
                params.tool_choice = "required";
                params.parallel_tool_calls = false;
            } else {
                if (params.response_format?.type === "json_object") {
                    params.response_format = {
                        type: "json_schema",
                        json_schema: jsonSchema,
                    };
                }
            }
        }
        return params;
    }

    parseResponse(data: unknown, request: ModelRequest): Result<string> {
        const completion = data as ChatCompletion;
        if (!completion.choices || completion.choices.length === 0) {
            return error("No choices returned");
        }
        if (Array.isArray(request.jsonSchema)) {
            const tool_calls = completion.choices[0].message?.tool_calls;
            if (tool_calls === undefined) {
                return error("No tool_calls returned");
            }
            if (tool_calls.length !== 1) {
                return error("Invalid number of tool_calls");
            }
            const c = tool_calls[0];
            if (c.type !== "function") {
                return error("Invalid tool call type");
            }
            return success(
                JSON.stringify({
                    name: c.function.name,
                    arguments: JSON.parse(c.function.arguments),
                }),
            );
        }
        return success(completion.choices[0].message?.content ?? "");
    }

    extractUsage(data: unknown): CompletionUsageStats | undefined {
        return (data as ChatCompletion).usage;
    }

    createStreamDecoder(request: ModelRequest): StreamDecoder {
        const isFunctionCalling = Array.isArray(request.jsonSchema);
        let emittedPrefix = "";
        return {
            push: (raw: string): StreamPiece => {
                const data = JSON.parse(raw) as ChatCompletionChunk;
                verifyStreamContentSafety(data);
                const piece: StreamPiece = {};
                if (data.choices && data.choices.length > 0) {
                    if (isFunctionCalling) {
                        const delta = data.choices[0].delta.tool_calls;
                        if (delta) {
                            for (const d of delta) {
                                if (d.index !== 0) {
                                    throw new Error(
                                        "Invalid number of tool_calls",
                                    );
                                }
                                if (emittedPrefix === "") {
                                    if (d.type !== "function") {
                                        throw new Error(
                                            "Invalid tool call type",
                                        );
                                    }
                                    if (!d.function.name) {
                                        throw new Error(
                                            "Invalid function name",
                                        );
                                    }
                                    emittedPrefix = `{"name":"${d.function.name}","arguments":${d.function.arguments ?? ""}`;
                                    piece.text = emittedPrefix;
                                } else {
                                    piece.text =
                                        (piece.text ?? "") +
                                        (d.function.arguments ?? "");
                                }
                            }
                        }
                    } else {
                        const delta = data.choices[0].delta.content;
                        if (delta) {
                            piece.text = delta;
                        }
                    }
                }
                if (data.usage) {
                    piece.usage = data.usage;
                }
                return piece;
            },
            finish: (): string | undefined => {
                return isFunctionCalling ? "}" : undefined;
            },
        };
    }
}

/** Singleton used by the dispatcher (adapters are stateless). */
export const chatCompletionsAdapter = new ChatCompletionsAdapter();
