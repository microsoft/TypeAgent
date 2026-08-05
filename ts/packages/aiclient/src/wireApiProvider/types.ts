// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PromptSection, Result } from "typechat";
import type { WireApi } from "@typeagent/config";
import type { ApiSettings, CompletionUsageStats } from "../openai.js";
import type { CompletionJsonSchema, CompletionSettings } from "../models.js";

export type ModelRequest = {
    messages: PromptSection[];
    jsonSchema?: CompletionJsonSchema | undefined;
    completionSettings: CompletionSettings;
    defaultParams: Record<string, unknown>;
    disableResponseFormat: boolean;
    modelName?: string | undefined;
    stream?: boolean | undefined;
    streamOptions?: Record<string, unknown> | undefined;
};

export type StreamPiece = {
    /** Single text chunk (content deltas). */
    text?: string | undefined;
    /**
     * Multiple yields for one SSE event (function-calling tool_call
     * deltas). Entries may be `undefined` to match legacy
     * `yield d.function.arguments` coercion behavior.
     * When `error` is also set, consumers must yield `texts` first then
     * throw — matches legacy mid-loop yield-then-throw on bad deltas.
     */
    texts?: (string | undefined)[] | undefined;
    usage?: CompletionUsageStats | undefined;
    /** Throw after yielding any `texts` (function-calling multi-delta). */
    error?: Error | undefined;
};

export interface StreamDecoder {
    push(data: string): StreamPiece;
    finish(): string | undefined;
}

export interface ProviderAdapter {
    readonly wireApi: WireApi;

    buildHeaders(
        settings: ApiSettings,
    ): Promise<Result<Record<string, string>>>;

    buildRequestBody(request: ModelRequest): unknown;

    parseResponse(data: unknown, request: ModelRequest): Result<string>;

    extractUsage(data: unknown): CompletionUsageStats | undefined;

    createStreamDecoder?(request: ModelRequest): StreamDecoder;
}

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
