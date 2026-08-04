// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Provider adapters: pluggable wire-protocol encoders/decoders.
 *
 * A `ProviderAdapter` owns everything that differs between LLM wire
 * protocols *after* the endpoint pool has already picked an endpoint:
 * the request headers (auth scheme), the request body shape, and how a
 * (streaming or non-streaming) HTTP response decodes into the model's
 * `string` result.
 *
 * The routing pool (`endpointPool.ts` / `restClient.ts`) is unchanged —
 * it still selects an endpoint by priority/capacity/cooldown. Only the
 * per-request encode/decode is dispatched here via `adapterFor(apiType)`.
 * This mirrors the shipping multi-provider pattern used by opencode
 * (`shouldUseCopilotResponsesApi`), Copilot-CLI (`copilot_model_api_mode`)
 * and hermes-agent (`ProviderProfile.api_mode` + `prepare_messages()` /
 * `build_extra_body()` hooks): one dispatch switch, N wire adapters.
 *
 * `apiType` is absent on legacy configs, which resolve to the default
 * `chat_completions` adapter — so existing Azure/OpenAI behavior is
 * byte-identical.
 */

import { PromptSection, Result, success, error } from "typechat";
import { ApiType } from "@typeagent/config";
import type { ApiSettings, CompletionUsageStats } from "./openai.js";
import type { CompletionJsonSchema, CompletionSettings } from "./models.js";

/**
 * Normalized, adapter-agnostic request. Built once by the chat-model
 * layer (`createAzureOpenAIChatModel`) after the completion settings have
 * been normalized (n/temperature defaults, max_tokens promotion,
 * response_format gating). Adapters translate this into their own wire
 * body shape.
 */
export type ModelRequest = {
    messages: PromptSection[];
    jsonSchema?: CompletionJsonSchema | undefined;
    /** Pre-normalized completion settings (temperature, max_completion_tokens, ...). */
    completionSettings: CompletionSettings & Record<string, unknown>;
    /** `{}` for Azure, `{ model }` for direct OpenAI. */
    defaultParams: Record<string, unknown>;
    /** True when the endpoint cannot honor response_format / json schema. */
    disableResponseFormat: boolean;
    /** Model name (direct OpenAI / non-Azure providers). */
    modelName?: string | undefined;
    /** Streaming request. */
    stream?: boolean | undefined;
    /** Extra options merged into the body for streaming (e.g. include_usage). */
    streamOptions?: Record<string, unknown> | undefined;
};

/**
 * One decoded slice of a streaming response. `text` is appended to the
 * output and yielded to the caller; `usage` (when present) is recorded
 * for token accounting. A single event may carry both.
 */
export type StreamPiece = {
    text?: string | undefined;
    usage?: CompletionUsageStats | undefined;
};

/**
 * Stateful decoder for one streaming response. `push` is called with the
 * raw `data:` payload of each SSE event; `finish` is called once at end
 * of stream (`[DONE]`) and may return trailing text (e.g. the closing
 * brace of an assembled function call). Implementations may throw to
 * abort the stream (content-filter violations).
 */
export interface StreamDecoder {
    push(data: string): StreamPiece;
    finish(): string | undefined;
}

/**
 * A wire-protocol adapter. Selected by `adapterFor(apiType)` after the
 * pool has chosen an endpoint; never participates in routing.
 */
export interface ProviderAdapter {
    readonly apiType: ApiType;

    /** Per-endpoint request headers (auth scheme differs by protocol). */
    buildHeaders(
        settings: ApiSettings,
    ): Promise<Result<Record<string, string>>>;

    /** Encode the normalized request into this protocol's body shape. */
    buildRequestBody(request: ModelRequest): unknown;

    /** Decode a non-streaming JSON response into the model's string result. */
    parseResponse(data: unknown, request: ModelRequest): Result<string>;

    /**
     * Extract token-usage stats from a non-streaming response for token
     * accounting. Streaming usage arrives via {@link StreamPiece.usage}.
     */
    extractUsage(data: unknown): CompletionUsageStats | undefined;

    /**
     * Create a stateful decoder for a streaming response. Adapters that do
     * not support streaming omit this; callers must fall back to
     * non-streaming completion.
     */
    createStreamDecoder?(request: ModelRequest): StreamDecoder;
}

// ---------------------------------------------------------------------------
// Shared helpers (also consumed by the non-chat image/embedding/video paths
// in openai.ts, which import them back from here — keeping the runtime
// dependency one-directional: openai.ts -> providerAdapter.ts).
// ---------------------------------------------------------------------------

/**
 * Build auth headers for OpenAI-style endpoints (chat_completions and
 * openai_responses both use this). Azure uses either an AAD bearer token
 * (identity) or the `api-key` header; direct OpenAI uses a bearer key +
 * organization header.
 */
export async function createApiHeaders(
    settings: ApiSettings,
): Promise<Result<Record<string, string>>> {
    let apiHeaders: Record<string, string> | undefined;
    if (settings.provider === "azure") {
        if (settings.tokenProvider) {
            const tokenResult = await settings.tokenProvider.getAccessToken();
            if (!tokenResult.success) {
                return tokenResult;
            }
            apiHeaders = {
                Authorization: `Bearer ${tokenResult.data}`,
            };
        } else {
            apiHeaders = { "api-key": settings.apiKey };
        }
    } else if (settings.provider === "openai") {
        apiHeaders = {
            Authorization: `Bearer ${settings.apiKey}`,
            "OpenAI-Organization": settings.organization ?? "",
        };
    }
    return success(apiHeaders ?? {});
}

// Content-filter wire types (Azure OpenAI chat/image responses).
export type Filter = {
    filtered: boolean;
    severity: string;
    detected?: boolean;
};

export type FilterError = {
    code: string;
    message: string;
};

export type FilterResult = {
    hate?: Filter;
    jailbreak?: Filter;
    protected_material_code?: Filter;
    protected_material_text?: Filter;
    self_harm?: Filter;
    sexual?: Filter;
    violence?: Filter;
    error?: FilterError;
};

/**
 * Throw if any Azure content filter tripped. Shared by the chat streaming
 * decoder (below) and the image path in openai.ts.
 */
export function verifyFilterResults(filterResult: FilterResult) {
    const filters: string[] = [];
    if (filterResult) {
        if (filterResult.hate?.filtered) {
            filters.push("hate");
        }
        if (filterResult.self_harm?.filtered) {
            filters.push("self_harm");
        }
        if (filterResult.sexual?.filtered) {
            filters.push("sexual");
        }
        if (filterResult.violence?.filtered) {
            filters.push("violence");
        }
        if (filterResult.protected_material_code?.filtered) {
            filters.push("protected_material_code");
        }
        if (filterResult.protected_material_text?.filtered) {
            filters.push("protected_material_text");
        }

        if (filters.length > 0) {
            const msg = `A content filter has been triggered by one or more messages. The triggered filters are: ${filters.join(", ")}`;
            throw new Error(`${msg}`);
        }
    }
}

// ---------------------------------------------------------------------------
// chat_completions wire types (OpenAI / Azure OpenAI Chat Completions API).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// chat_completions adapter — the default. This is a faithful extraction of
// the request/response logic that lived inline in createAzureOpenAIChatModel,
// so the default path is byte-identical to before adapters existed.
// ---------------------------------------------------------------------------

class ChatCompletionsAdapter implements ProviderAdapter {
    readonly apiType: ApiType = "chat_completions";

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

// ---------------------------------------------------------------------------
// Shared usage mapping. Non-OpenAI protocols report input/output token
// counts under different keys; normalize to CompletionUsageStats.
// ---------------------------------------------------------------------------

function usageFromInputOutput(
    inputTokens: number | undefined,
    outputTokens: number | undefined,
): CompletionUsageStats | undefined {
    if (inputTokens === undefined && outputTokens === undefined) {
        return undefined;
    }
    const prompt = inputTokens ?? 0;
    const completion = outputTokens ?? 0;
    return {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: prompt + completion,
    };
}

/** Concatenate system prompt sections; return the rest as user/assistant turns. */
function splitSystemMessages(messages: PromptSection[]): {
    system: string;
    turns: { role: string; content: unknown }[];
} {
    const systemParts: string[] = [];
    const turns: { role: string; content: unknown }[] = [];
    for (const m of messages) {
        if (m.role === "system") {
            if (typeof m.content === "string") {
                systemParts.push(m.content);
            }
            continue;
        }
        turns.push({ role: m.role, content: m.content });
    }
    return { system: systemParts.join("\n\n"), turns };
}

// ---------------------------------------------------------------------------
// anthropic_messages adapter — reference implementation for a non-Azure,
// non-OpenAI wire protocol (Anthropic Messages API). Demonstrates a fully
// different auth scheme (x-api-key + anthropic-version), request body
// (system split out, required max_tokens) and response shape (content
// blocks), proving the adapter seam generalizes beyond OpenAI-shaped APIs.
// ---------------------------------------------------------------------------

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

class AnthropicMessagesAdapter implements ProviderAdapter {
    readonly apiType: ApiType = "anthropic_messages";

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

// ---------------------------------------------------------------------------
// openai_responses adapter — reference implementation for the OpenAI
// OpenAI Responses API (/responses wire protocol). Same auth
// as chat_completions but a different body (`input`) and response
// (`output` blocks / `output_text`).
// ---------------------------------------------------------------------------

type ResponsesOutputContent = { type: string; text?: string };
type ResponsesOutputItem = {
    type?: string;
    content?: ResponsesOutputContent[];
    name?: string;
    arguments?: string;
};
type ResponsesResult = {
    output_text?: string;
    output?: ResponsesOutputItem[];
    usage?: { input_tokens?: number; output_tokens?: number };
};

class OpenAIResponsesAdapter implements ProviderAdapter {
    readonly apiType: ApiType = "openai_responses";

    buildHeaders(settings: ApiSettings) {
        // Responses API uses the same OpenAI/Azure auth as chat_completions.
        return createApiHeaders(settings);
    }

    buildRequestBody(request: ModelRequest): unknown {
        const { system, turns } = splitSystemMessages(request.messages);
        const cs = request.completionSettings;
        const input = turns.map((t) => ({
            role: t.role,
            content: [
                {
                    type: t.role === "assistant" ? "output_text" : "input_text",
                    text:
                        typeof t.content === "string"
                            ? t.content
                            : JSON.stringify(t.content),
                },
            ],
        }));
        const body: Record<string, unknown> = {
            ...request.defaultParams,
            input,
        };
        if (system) {
            body.instructions = system;
        }
        if (typeof cs.temperature === "number") {
            body.temperature = cs.temperature;
        }
        const maxOut =
            (cs.max_completion_tokens as number | undefined) ??
            (cs.max_tokens as number | undefined);
        if (maxOut !== undefined) {
            body.max_output_tokens = maxOut;
        }
        if (request.stream) {
            body.stream = true;
        }
        return body;
    }

    parseResponse(data: unknown, _request: ModelRequest): Result<string> {
        const res = data as ResponsesResult;
        if (typeof res.output_text === "string") {
            return success(res.output_text);
        }
        const parts: string[] = [];
        for (const item of res.output ?? []) {
            for (const c of item.content ?? []) {
                if (c.type === "output_text" && typeof c.text === "string") {
                    parts.push(c.text);
                }
            }
        }
        return success(parts.join(""));
    }

    extractUsage(data: unknown): CompletionUsageStats | undefined {
        const usage = (data as ResponsesResult).usage;
        return usageFromInputOutput(usage?.input_tokens, usage?.output_tokens);
    }

    createStreamDecoder(): StreamDecoder {
        // Responses SSE: response.output_text.delta { delta } for text,
        // response.completed { response: { usage } } for final counts.
        return {
            push: (raw: string): StreamPiece => {
                const evt = JSON.parse(raw) as {
                    type?: string;
                    delta?: string;
                    response?: {
                        usage?: {
                            input_tokens?: number;
                            output_tokens?: number;
                        };
                    };
                };
                const piece: StreamPiece = {};
                if (
                    evt.type === "response.output_text.delta" &&
                    typeof evt.delta === "string"
                ) {
                    piece.text = evt.delta;
                }
                const usage = evt.response?.usage;
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

// ---------------------------------------------------------------------------
// Dispatch. Adapters are stateless singletons; per-request state lives in
// the StreamDecoder returned by createStreamDecoder.
// ---------------------------------------------------------------------------

const chatCompletionsAdapter = new ChatCompletionsAdapter();
const anthropicMessagesAdapter = new AnthropicMessagesAdapter();
const openaiResponsesAdapter = new OpenAIResponsesAdapter();

/**
 * Select the wire adapter for an api-type. Called after the pool has
 * chosen an endpoint. `undefined` (legacy configs) → the default
 * `chat_completions` adapter, so back-compat is exact.
 */
export function adapterFor(apiType: ApiType | undefined): ProviderAdapter {
    switch (apiType) {
        case "anthropic_messages":
            return anthropicMessagesAdapter;
        case "openai_responses":
            return openaiResponsesAdapter;
        case "chat_completions":
        case undefined:
            return chatCompletionsAdapter;
        default: {
            // Exhaustiveness guard: a new ApiType must add a case above.
            const _exhaustive: never = apiType;
            void _exhaustive;
            return chatCompletionsAdapter;
        }
    }
}
