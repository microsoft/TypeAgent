// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared types for wire-protocol provider adapters.
 *
 * A `ProviderAdapter` owns everything that differs between LLM wire
 * protocols *after* the endpoint pool has already picked an endpoint:
 * request headers, request body shape, and response decoding.
 */

import type { PromptSection, Result } from "typechat";
import type { WireApi } from "@typeagent/config";
import type { ApiSettings, CompletionUsageStats } from "../openai.js";
import type { CompletionJsonSchema, CompletionSettings } from "../models.js";

/**
 * Normalized, adapter-agnostic request. Built once by the chat-model
 * layer after completion settings are normalized. Adapters translate
 * this into their own wire body shape.
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
 * A wire-protocol adapter. Selected by `adapterFor(wireApi)` after the
 * pool has chosen an endpoint; never participates in routing.
 */
export interface ProviderAdapter {
    readonly wireApi: WireApi;

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
