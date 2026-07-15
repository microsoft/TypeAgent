// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Direct-CAPI transport for the Copilot provider.
//
// The SDK/CLI is used only to mint a provider endpoint (URL + credentials) via
// `session.rpc.provider.getEndpoint` — see `createCopilotEndpointProvider` in
// copilotModels.ts. This module consumes that endpoint and issues translation
// requests as plain HTTP `chat/completions` calls, mirroring the Azure/OpenAI
// HTTP path (single-member endpoint pool + shared restClient primitives) so
// behavior around retries, timeouts and throttling matches the rest of the
// stack. A single reactive endpoint refresh is attempted on a non-2xx (e.g. an
// expired credential); on continued failure the request returns an error (no
// SDK fallback). Image content isn't supported over this transport.

import {
    PromptSection,
    Result,
    success,
    error,
    MultimodalPromptContent,
    ImagePromptContent,
} from "typechat";
import registerDebug from "debug";
import {
    ChatModelWithStreaming,
    CompletionSettings,
    CompletionJsonSchema,
    CompleteUsageStatsCallback,
} from "./models.js";
import { CompletionUsageStats } from "./openai.js";
import { CopilotApiSettings } from "./copilotSettings.js";
import {
    BuildPoolRequest,
    callApiWithPool,
    callJsonApiWithPool,
} from "./restClient.js";
import { EndpointPool, makeSingleMemberPool } from "./endpointPool.js";
import { readServerEventStream } from "./serverEvents.js";
import { TokenCounter } from "./tokenCounter.js";

const debug = registerDebug("typeagent:aiclient:copilot:direct");
const debugTiming = registerDebug("typeagent:aiclient:copilot:timing");

/**
 * A cached, ready-to-use direct-CAPI endpoint snapshot. `headers` already
 * includes the credential (`Authorization`) and any short-lived session-token
 * header, so callers only add `Content-Type`.
 */
export interface CopilotEndpoint {
    /** Full chat-completions URL (baseUrl + "/chat/completions"). */
    url: string;
    /** Resolved model id to send in the request body. */
    model: string;
    /** HTTP headers to send on every request (credential included). */
    headers: Record<string, string>;
    /** Epoch ms when the endpoint credential expires, if known. */
    expiresAt?: number | undefined;
}

/** Acquires/caches/refreshes {@link CopilotEndpoint}s. */
export interface CopilotEndpointProvider {
    /**
     * Return a usable endpoint, minting a fresh one via the SDK when the cache
     * is empty/expired or `force` is set. Concurrent callers coalesce onto a
     * single acquisition.
     */
    getEndpoint(force?: boolean): Promise<CopilotEndpoint>;
}

/**
 * Thrown by an endpoint provider when a direct endpoint can't be minted for the
 * requested model (e.g. the tenant doesn't offer it and only "auto" is left, or
 * the SDK gate is disabled).
 */
export class CopilotEndpointUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CopilotEndpointUnavailableError";
    }
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
    return (
        signal?.aborted === true ||
        (err instanceof Error && err.name === "AbortError")
    );
}

// Minimal shape of the CAPI chat-completions response we consume.
type CapiChatCompletion = {
    choices?: Array<{ message?: { content?: string | null } | undefined }>;
    usage?: CompletionUsageStats | undefined;
};

// Minimal shape of a streamed CAPI chat-completions chunk.
type CapiChatCompletionChunk = {
    choices?: Array<{ delta?: { content?: string | null } | undefined }>;
    usage?: CompletionUsageStats | undefined;
};

function hasImageContent(messages: PromptSection[]): boolean {
    const isImage = (c: MultimodalPromptContent) =>
        (c as ImagePromptContent).type === "image_url";
    return messages.some(
        (ps) => Array.isArray(ps.content) && ps.content.some(isImage),
    );
}

/**
 * Create a Copilot chat model backed by the direct-CAPI transport. Image
 * content isn't supported by this transport and returns an error.
 */
export function createCopilotDirectChatModel(
    settings: CopilotApiSettings,
    completionSettings: CompletionSettings | undefined,
    completionCallback: ((request: any, response: any) => void) | undefined,
    tags: string[] | undefined,
    endpointProvider: CopilotEndpointProvider,
): ChatModelWithStreaming {
    completionSettings ??= {};
    completionSettings.n ??= 1;
    // Match the Azure default; translation calls want deterministic output.
    completionSettings.temperature ??= 0;

    // A one-member pool so we reuse the shared restClient retry/throttle path.
    // `endpoint` is overwritten per request from the freshly-resolved endpoint
    // URL (the single-member fetch path reads settings.endpoint AFTER building
    // the request). We copy the settings so we never clobber the caller's.
    const poolSettings: CopilotApiSettings = { ...settings, endpoint: "" };
    const pool: EndpointPool = makeSingleMemberPool(
        poolSettings,
        `copilot:${settings.modelName}`,
    );

    const model: ChatModelWithStreaming = {
        completionSettings,
        completionCallback,
        complete,
        completeStream,
    };
    return model;

    function buildRequest(params: any): BuildPoolRequest {
        return async (member) => {
            let ep: CopilotEndpoint;
            try {
                ep = await endpointProvider.getEndpoint();
            } catch (err) {
                return error(
                    `getEndpoint failed: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
            member.settings.endpoint = ep.url;
            return success({
                headers: { ...ep.headers },
                body: { ...params, model: ep.model },
            });
        };
    }

    function getParams(messages: PromptSection[]): any {
        return {
            messages,
            ...completionSettings,
        };
    }

    function reportUsage(
        usage: CompletionUsageStats | undefined,
        usageCallback?: CompleteUsageStatsCallback,
    ) {
        if (usage === undefined) return;
        try {
            TokenCounter.getInstance().add(usage, tags);
            usageCallback?.(usage);
        } catch {}
    }

    async function complete(
        prompt: string | PromptSection[],
        usageCallback?: CompleteUsageStatsCallback,
        _jsonSchema?: CompletionJsonSchema,
        logFn?: (msg: any) => void,
        signal?: AbortSignal,
    ): Promise<Result<string>> {
        const messages: PromptSection[] =
            typeof prompt === "string"
                ? [{ role: "user", content: prompt }]
                : prompt;

        // Images aren't supported over this transport.
        if (hasImageContent(messages)) {
            return error(
                "Image content is not supported by the Copilot direct transport",
            );
        }

        const params = getParams(messages);
        const request = buildRequest(params);
        const options = {
            retryPauseMs: settings.retryPauseMs,
            signal,
        };

        const tTotal = Date.now();

        let result: Result<unknown>;
        try {
            result = await callJsonApiWithPool(pool, request, options);
        } catch (err) {
            if (isAbort(err, signal)) {
                return error("Request aborted");
            }
            return error(err instanceof Error ? err.message : String(err));
        }

        // A returned (non-thrown) error means a non-transient status (e.g.
        // 401/403/400) or exhausted retries. Refresh the endpoint once — this
        // covers an expired credential — and retry before giving up.
        if (!result.success) {
            debug(
                `direct call failed (${result.message}); refreshing endpoint`,
            );
            try {
                await endpointProvider.getEndpoint(true);
            } catch {}
            try {
                result = await callJsonApiWithPool(pool, request, options);
            } catch (err) {
                if (isAbort(err, signal)) {
                    return error("Request aborted");
                }
                return error(err instanceof Error ? err.message : String(err));
            }
            if (!result.success) {
                return result;
            }
        }

        const data = result.data as CapiChatCompletion;
        if (!data.choices || data.choices.length === 0) {
            return error("Copilot direct call returned no choices");
        }
        const content = data.choices[0].message?.content ?? "";

        if (model.completionCallback) {
            model.completionCallback(params, data);
        }
        try {
            if (settings.enableModelRequestLogging && logFn) {
                logFn({
                    prompt: messages,
                    response: content,
                    tokenUsage: data.usage,
                    tags,
                });
            }
        } catch {}
        reportUsage(data.usage, usageCallback);

        debugTiming(`direct complete total ${Date.now() - tTotal}ms`);
        return success(content);
    }

    // Stream translation output as it arrives, mirroring the Azure/OpenAI
    // streaming path (SSE via `readServerEventStream`, with a final usage chunk
    // from `stream_options.include_usage`). Returns an error for images or when
    // the direct connection can't be established (after one reactive refresh).
    async function completeStream(
        prompt: string | PromptSection[],
        usageCallback?: CompleteUsageStatsCallback,
        _jsonSchema?: CompletionJsonSchema,
        logFn?: (msg: any) => void,
        signal?: AbortSignal,
    ): Promise<Result<AsyncIterableIterator<string>>> {
        const messages: PromptSection[] =
            typeof prompt === "string"
                ? [{ role: "user", content: prompt }]
                : prompt;

        if (hasImageContent(messages)) {
            return error(
                "Image content is not supported by the Copilot direct transport",
            );
        }

        const params = {
            ...getParams(messages),
            stream: true,
            stream_options: { include_usage: true },
        };
        const request = buildRequest(params);
        const options = {
            retryPauseMs: settings.retryPauseMs,
            signal,
        };

        let result = await callApiWithPool(pool, request, options);
        if (!result.success) {
            debug(
                `direct stream connect failed (${result.message}); ` +
                    `refreshing endpoint`,
            );
            try {
                await endpointProvider.getEndpoint(true);
            } catch {}
            result = await callApiWithPool(pool, request, options);
            if (!result.success) {
                return result;
            }
        }

        const response = result.data;
        return {
            success: true,
            data: (async function* () {
                let fullResponseText = "";
                let tokenUsage: CompletionUsageStats | undefined;
                for await (const evt of readServerEventStream(
                    response,
                    signal,
                )) {
                    if (signal?.aborted) break;
                    if (evt.data === "[DONE]") {
                        try {
                            if (settings.enableModelRequestLogging && logFn) {
                                logFn({
                                    prompt: messages,
                                    response: fullResponseText,
                                    tokenUsage,
                                    tags,
                                });
                            }
                        } catch {}
                        break;
                    }
                    let chunk: CapiChatCompletionChunk;
                    try {
                        chunk = JSON.parse(evt.data) as CapiChatCompletionChunk;
                    } catch {
                        // Ignore non-JSON keep-alive/comment lines.
                        continue;
                    }
                    const delta = chunk.choices?.[0]?.delta?.content;
                    if (delta) {
                        fullResponseText += delta;
                        yield delta;
                    }
                    if (chunk.usage) {
                        tokenUsage = chunk.usage;
                        reportUsage(chunk.usage, usageCallback);
                    }
                }
            })(),
        };
    }
}
