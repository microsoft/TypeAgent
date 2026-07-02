// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    TextEmbeddingModel,
    CompletionSettings,
    ChatModel,
    ChatModelWithStreaming,
    ImageModel,
    ImageGeneration,
    CompletionJsonSchema,
    CompleteUsageStatsCallback,
    VideoModel,
    VideoGenerationJob,
    ImageInPaintItem,
} from "./models.js";
import {
    BuildPoolRequest,
    callApiWithPool,
    callJsonApiWithPool,
    FetchThrottler,
} from "./restClient.js";
import { getEnvSetting } from "./common.js";
import {
    discoverEndpointPool,
    EndpointPool,
    makeSingleMemberPool,
} from "./endpointPool.js";
import { discoverEndpointPoolFromConfig } from "./endpointPoolFromConfig.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import {
    PromptSection,
    Result,
    success,
    error,
    TypeChatLanguageModel,
    MultimodalPromptContent,
    ImagePromptContent,
} from "typechat";
import { readServerEventStream } from "./serverEvents.js";
import { priorityQueue } from "async";
import registerDebug from "debug";
import { TokenCounter } from "./tokenCounter.js";
import {
    createOllamaChatModel,
    OllamaApiSettings,
    ollamaApiSettingsFromEnv,
} from "./ollamaModels.js";
import {
    OpenAIApiSettings,
    openAIApiSettingsFromEnv,
} from "./openaiSettings.js";
import { AzureApiSettings, azureApiSettingsFromEnv } from "./azureSettings.js";
import {
    CopilotApiSettings,
    copilotApiSettingsFromConfig,
} from "./copilotSettings.js";
import { createCopilotChatModel } from "./copilotModels.js";
import { getActiveModelProvider, resolveTarget } from "./providerMode.js";

export { azureApiSettingsFromEnv, openAIApiSettingsFromEnv };

const debugOpenAI = registerDebug("typeagent:openai");

export enum ModelType {
    Chat = "chat",
    Embedding = "embedding",
    Image = "image",
    Video = "video",
}

export type ModelInfo<T> = {
    type: ModelType;
    model: T;
    endpointName?: string;
    maxTokens: number;
};

export type ModelProviders = "openai" | "azure" | "ollama" | "copilot";

export type CommonApiSettings = {
    provider: ModelProviders;
    modelType: ModelType;
    endpoint: string;
    maxConcurrency?: number | undefined;
    throttler?: FetchThrottler;
    enableModelRequestLogging?: boolean | undefined;
    timeout?: number | undefined;
    maxRetryAttempts?: number | undefined;
    retryPauseMs?: number | undefined;
    /**
     * When a deployment rejects the requested output budget (e.g.
     * "max_tokens is too large: 16384. This model supports at most 4096
     * completion tokens"), automatically lower `max_completion_tokens` to
     * the reported limit and retry once. Defaults to enabled; set to
     * `false` to surface the error instead.
     */
    adaptiveOutputTokens?: boolean | undefined;
};
/**
 * Settings used by OpenAI clients
 */
export type ApiSettings =
    | OllamaApiSettings
    | AzureApiSettings
    | OpenAIApiSettings
    | CopilotApiSettings;

/**
 * Environment variables used to configure OpenAI clients
 */
export enum EnvVars {
    OPENAI_API_KEY = "OPENAI_API_KEY",
    OPENAI_ENDPOINT = "OPENAI_ENDPOINT",
    OPENAI_ENDPOINT_EMBEDDING = "OPENAI_ENDPOINT_EMBEDDING",

    OPENAI_ORGANIZATION = "OPENAI_ORGANIZATION",
    OPENAI_MODEL = "OPENAI_MODEL",
    OPENAI_RESPONSE_FORMAT = "OPENAI_RESPONSE_FORMAT",
    OPENAI_MAX_CONCURRENCY = "AZURE_OPENAI_MAX_CONCURRENCY",
    OPENAI_MAX_TIMEOUT = "OPENAI_MAX_TIMEOUT",
    OPENAI_MAX_RETRYATTEMPTS = "OPENAI_MAX_RETRYATTEMPTS",
    OPENAI_MODEL_EMBEDDING = "OPENAI_MODEL_EMBEDDING",

    AZURE_OPENAI_API_KEY = "AZURE_OPENAI_API_KEY",
    AZURE_OPENAI_ENDPOINT = "AZURE_OPENAI_ENDPOINT",
    AZURE_OPENAI_RESPONSE_FORMAT = "AZURE_OPENAI_RESPONSE_FORMAT",
    AZURE_OPENAI_MAX_CONCURRENCY = "AZURE_OPENAI_MAX_CONCURRENCY",
    AZURE_OPENAI_MAX_TIMEOUT = "AZURE_OPENAI_MAX_TIMEOUT",
    AZURE_OPENAI_MAX_RETRYATTEMPTS = "AZURE_OPENAI_MAX_RETRYATTEMPTS",
    AZURE_OPENAI_MAX_CHARS = "AZURE_OPENAI_MAX_CHARS",

    AZURE_OPENAI_API_KEY_EMBEDDING = "AZURE_OPENAI_API_KEY_EMBEDDING",
    AZURE_OPENAI_ENDPOINT_EMBEDDING = "AZURE_OPENAI_ENDPOINT_EMBEDDING",

    AZURE_OPENAI_API_KEY_GPT_IMAGE_1_5 = "AZURE_OPENAI_API_KEY_GPT_IMAGE_1_5",
    AZURE_OPENAI_ENDPOINT_GPT_IMAGE_1_5 = "AZURE_OPENAI_ENDPOINT_GPT_IMAGE_1_5",
    // Generic fallback for any current/future image model
    AZURE_OPENAI_API_KEY_GPT_IMAGE = "AZURE_OPENAI_API_KEY_GPT_IMAGE",
    AZURE_OPENAI_ENDPOINT_GPT_IMAGE = "AZURE_OPENAI_ENDPOINT_GPT_IMAGE",
    AZURE_OPENAI_API_KEY_SORA_2 = "AZURE_OPENAI_API_KEY_SORA_2",
    AZURE_OPENAI_ENDPOINT_SORA_2 = "AZURE_OPENAI_ENDPOINT_SORA_2",

    OLLAMA_ENDPOINT = "OLLAMA_ENDPOINT",

    AZURE_MAPS_ENDPOINT = "AZURE_MAPS_ENDPOINT",
    AZURE_MAPS_CLIENTID = "AZURE_MAPS_CLIENTID",

    ENABLE_MODEL_REQUEST_LOGGING = "ENABLE_MODEL_REQUEST_LOGGING",

    AZURE_STORAGE_ACCOUNT = "AZURE_STORAGE_ACCOUNT",
    AZURE_STORAGE_CONTAINER = "AZURE_STORAGE_CONTAINER",
}

export const MAX_PROMPT_LENGTH_DEFAULT = 1000 * 60;

/**
 * Initialize settings from environment variables
 * @param modelType
 * @param env Environment variables or arbitrary Record
 * @param endpointName optional suffix to add to env variable names. Lets you target different backends
 * @returns
 *
 * @deprecated Use the typed-config entry points instead
 * (`azureApiSettingsFromConfig` / `openAIApiSettingsFromConfig` in
 * `apiSettingsFromConfig.ts`). The env-based path bypasses the YAML
 * config loaded via `@typeagent/config` and will fail when only
 * suffixed deployments (e.g. `AZURE_OPENAI_ENDPOINT_GPT_4_O`) are
 * configured without a bare `AZURE_OPENAI_ENDPOINT`. Existing
 * callers continue to work because this function now consults the
 * typed config before falling back to env scanning, but new code
 * should call the typed entry points directly.
 */
export function apiSettingsFromEnv(
    modelType: ModelType = ModelType.Chat,
    env?: Record<string, string | undefined>,
    endpointName?: string,
): ApiSettings {
    // Provider-mode override applies to chat only. Embeddings, images,
    // and video stay on whatever the legacy resolver picks (Azure/OpenAI).
    const mode = getActiveModelProvider();
    if (mode !== undefined && modelType === ModelType.Chat) {
        const target = resolveTarget(mode, endpointName ?? "DEFAULT");
        if (mode === "copilot") {
            return copilotApiSettingsFromConfig(target);
        }
        if (mode === "ollama") {
            return ollamaApiSettingsFromEnv(modelType, env, target);
        }
        if (mode === "openai") {
            return openAIApiSettingsFromEnv(modelType, env, target);
        }
        // mode === "azure" falls through to legacy logic with the (identity-
        // mapped) target — preserves the historical resolution path.
        return azureApiSettingsFromEnv(modelType, env, target);
    }

    env ??= process.env;
    if (EnvVars.OPENAI_API_KEY in env) {
        return openAIApiSettingsFromEnv(modelType, env, endpointName);
    }

    return azureApiSettingsFromEnv(modelType, env, endpointName);
}

/**
 * Loads settings that support local services supporting the Open AI API spec
 * @param modelType Type of setting
 * @param env Environment variables
 * @param endpointName
 * @param tags Tags for tracking usage of this model instance
 * @returns API settings, or undefined if endpoint was not defined
 */
export function localOpenAIApiSettingsFromEnv(
    modelType: ModelType,
    env?: Record<string, string | undefined>,
    endpointName?: string,
    tags?: string[],
): ApiSettings | undefined {
    env ??= process.env;
    endpointName ??= "Local";
    if (
        getEnvSetting(
            env,
            EnvVars.OPENAI_ENDPOINT,
            endpointName,
            "undefined",
        ) === "undefined"
    ) {
        return undefined;
    }
    return openAIApiSettingsFromEnv(modelType, env, endpointName, true);
}

/**
 * Create an Open AI client. Supports both OpenAI and AzureOpenAI endpoints
 * @param settings settings to use for creating client
 * @returns headers used for API connections
 */
async function createApiHeaders(settings: ApiSettings): Promise<Result<any>> {
    let apiHeaders;
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

    return success(apiHeaders);
}

// Parse the endpoint name with the following naming conventions
//
// - By default, if endpoint name is not specified, it defaults to `OPENAI_ENDPOINT` if it exists, and `AZURE_OPENAI_ENDPOINT` otherwise.
// - Endpoint names `azure` and `openai` refers to `AZURE_OPENAI_ENDPOINT` and `OPENAI_ENDPOINT`
// - Endpoint names `azure:<name>` and `openai:<name>` refers to `AZURE_OPENAI_ENDPOINT_<name>` and `OPENAI_ENDPOINT_<name>`
// - Endpoint names without the `azure:` or `openai:` prefix will assume it is prefixed with `azure:` and uses `AZURE_OPENAI_ENDPOINT_<name>`

function parseEndPointName(endpoint?: string): {
    provider: ModelProviders;
    name?: string;
} {
    if (endpoint === undefined || endpoint === "") {
        const mode = getActiveModelProvider();
        if (mode !== undefined) {
            return { provider: mode, name: resolveTarget(mode, "DEFAULT") };
        }
        return {
            provider:
                EnvVars.OPENAI_ENDPOINT in process.env ? "openai" : "azure",
        };
    }
    if (
        endpoint === "openai" ||
        endpoint === "azure" ||
        endpoint === "ollama" ||
        endpoint === "copilot"
    ) {
        return { provider: endpoint };
    }
    if (endpoint.startsWith("openai:")) {
        return { provider: "openai", name: endpoint.substring(7) };
    }
    if (endpoint.startsWith("ollama:")) {
        return { provider: "ollama", name: endpoint.substring(7) };
    }
    if (endpoint.startsWith("azure:")) {
        return { provider: "azure", name: endpoint.substring(6) };
    }
    if (endpoint.startsWith("copilot:")) {
        return { provider: "copilot", name: endpoint.substring(8) };
    }
    // Provider-mode override: route an unprefixed canonical name through
    // the active mode's mapping. Explicit prefixes above always win.
    const mode = getActiveModelProvider();
    if (mode !== undefined) {
        const target = resolveTarget(mode, endpoint);
        return { provider: mode, name: target };
    }
    if (EnvVars.OPENAI_ENDPOINT in process.env) {
        return { provider: "openai", name: endpoint };
    }
    return { provider: "azure", name: endpoint };
}

// Cache of per-model endpoint pools. Keyed by
// `${modelType}:${provider}:${endpointName}`.
const modelPools = new Map<string, EndpointPool>();

function defaultProvider(): ModelProviders {
    return EnvVars.OPENAI_API_KEY in process.env ? "openai" : "azure";
}

function getModelPool(
    provider: ModelProviders,
    modelType: ModelType,
    endpointName?: string,
): EndpointPool {
    const key = `${modelType}:${provider}:${endpointName ?? ""}`;
    const existing = modelPools.get(key);
    if (existing) return existing;
    const pool = buildModelPool(provider, modelType, endpointName);
    modelPools.set(key, pool);
    return pool;
}

// Try the typed-Config path first; if it fails (typically because the
// caller's deployment uses a non-canonical region alias that the typed
// REGIONS set doesn't carry), fall back to the legacy env-scanning
// discovery. Both paths read the same underlying values via process.env
// / the singleton built from it, so the pool contents converge.
function buildModelPool(
    provider: ModelProviders,
    modelType: ModelType,
    endpointName?: string,
): EndpointPool {
    if (provider !== "ollama" && provider !== "copilot") {
        try {
            const typedName = endpointName?.toLowerCase();
            return discoverEndpointPoolFromConfig(
                getRuntimeConfig(),
                provider,
                modelType,
                typedName,
            );
        } catch {
            // Fall through to legacy.
        }
    }
    return discoverEndpointPool(provider, modelType, endpointName);
}

export function getChatModelPool(endpoint?: string): EndpointPool {
    const endpointName = parseEndPointName(endpoint);
    const key = `${ModelType.Chat}:${endpointName.provider}:${endpointName.name ?? ""}`;
    const existing = modelPools.get(key);
    if (existing) {
        return existing;
    }

    let pool: EndpointPool;
    if (endpointName.provider === "ollama") {
        // Ollama is single-endpoint; attach the throttler via the legacy path.
        const settings = ollamaApiSettingsFromEnv(
            ModelType.Chat,
            undefined,
            endpointName.name,
        );
        if (settings.maxConcurrency !== undefined) {
            const q = priorityQueue<() => Promise<any>>(
                async (task) => task(),
                settings.maxConcurrency,
            );
            settings.throttler = (fn: () => Promise<any>, priority?: number) =>
                q.push<any>(fn, priority);
        }
        pool = makeSingleMemberPool(settings, key);
    } else if (endpointName.provider === "copilot") {
        // Copilot is single-endpoint (the spawned CLI); no HTTP pool.
        const settings = copilotApiSettingsFromConfig(endpointName.name);
        if (settings.maxConcurrency !== undefined) {
            const q = priorityQueue<() => Promise<any>>(
                async (task) => task(),
                settings.maxConcurrency,
            );
            settings.throttler = (fn: () => Promise<any>, priority?: number) =>
                q.push<any>(fn, priority);
        }
        pool = makeSingleMemberPool(settings, key);
    } else {
        pool = getModelPool(
            endpointName.provider,
            ModelType.Chat,
            endpointName.name,
        );
    }

    modelPools.set(key, pool);
    return pool;
}

/**
 * Legacy accessor. Returns the preferred (tier-1 / bare) member's settings.
 * Kept to preserve the public API used by dispatcher, kp, and modelResource.
 * For multi-endpoint pools, callers who need pool-aware behavior should use
 * {@link getChatModelPool}. Mutations to the returned settings affect only
 * the preferred member, which is the same semantic callers had before pools.
 */
export function getChatModelSettings(endpoint?: string): ApiSettings {
    const pool = getChatModelPool(endpoint);
    return pool.members[0].settings;
}

export function supportsStreaming(
    model: TypeChatLanguageModel,
): model is ChatModelWithStreaming {
    return "completeStream" in model;
}

type FilterResult = {
    hate?: Filter;
    jailbreak?: Filter;
    protected_material_code?: Filter;
    protected_material_text?: Filter;
    self_harm?: Filter;
    sexual?: Filter;
    violence?: Filter;
    error?: FilterError;
};

type FilterError = {
    code: string;
    message: string;
};

type Filter = {
    filtered: boolean;
    severity: string;
    detected?: boolean;
};

// NOTE: these are not complete
type ChatCompletion = {
    id: string;
    choices: ChatCompletionChoice[];
    usage: CompletionUsageStats;
};

type ToolCall = {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
};

type ChatCompletionChoice = {
    message?: ChatContent;
    content_filter_results?: FilterResult | FilterError;
    finish_reason?: string;
};

type ChatCompletionChunk = {
    id: string;
    choices: ChatCompletionDelta[];
    usage?: CompletionUsageStats;
};

type ToolCallDelta = { index: number } & ToolCall;

type ChatCompletionDelta = {
    delta: ChatContent<ToolCallDelta>;
    content_filter_results?: FilterResult | FilterError;
    finish_reason?: string;
};

type ChatContent<ToolCallType = ToolCall> = {
    content?: string | null;
    tool_calls?: ToolCallType[];
    role: "assistant";
};

type ImageCompletion = {
    created: number;
    data: ImageData[];
};

type ImageData = {
    content_filter_results: FilterResult | FilterError;
    prompt_filter_results: FilterResult | FilterError;
    revised_prompt?: string;
    url?: string;
    b64_json?: string;
};

// Statistics returned by the OAI api
export type CompletionUsageStats = {
    // Number of tokens in the generated completion
    completion_tokens: number;
    // Number of tokens in the prompt
    prompt_tokens: number;
    // Total tokens (prompt + completion)
    total_tokens: number;
};

/**
 * Create a client for an Open AI chat model
 *  createChatModel()
 *     Initialize using standard TypeChat Env variables
 *  createChatModel("GPT_35_TURBO")
 *     Use the name as a SUFFIX for standard TypeChat Env variable names
 *     If no suffix variable exists, falls back to using defaults.
 *  createChatModel(azureApiSettingsFromEnv())
 *     You supply API settings
 *  createChatModel(apiSettings)
 *     You supply API settings
 * @param endpoint The name of the API endpoint OR explicit API settings with which to create a client
 * @param completionSettings Completion settings for the model
 * @param completionCallback A callback to be called when the response is returned from the api
 * @param tags Tags for tracking usage of this model instance
 * @returns ChatModel
 */

/**
 * Maximum completion (output) tokens supported by known model families.
 * Patterns are matched in order against a normalized model/deployment name,
 * so more specific families (gpt-4.1, gpt-4o) must precede less specific
 * ones (gpt-4). Used to request the full output budget so large responses
 * (e.g. knowledge extraction) aren't silently truncated. Unknown models
 * return undefined and keep the deployment default.
 */
const MODEL_MAX_OUTPUT_TOKENS: ReadonlyArray<readonly [RegExp, number]> = [
    [/gpt-?4\.?1/, 32768], // gpt-4.1, gpt-4.1-mini, gpt-4.1-nano
    [/gpt-?4-?o/, 16384], // gpt-4o, gpt-4o-mini
    [/gpt-?5/, 16384], // gpt-5, gpt-5-mini, gpt-5-nano, gpt-5-chat
    [/gpt-?3\.?5/, 4096], // gpt-3.5-turbo
    [/gpt-?4/, 4096], // gpt-4, gpt-4-turbo
    [/(^|[^a-z0-9])o[134]([^a-z0-9]|$)/, 100000], // o1, o3, o4 reasoning
];

/**
 * Resolve the underlying model/deployment name from API settings. OpenAI
 * settings carry `modelName` directly; Azure encodes the deployment in the
 * endpoint URL (`.../deployments/<name>/...`).
 */
function resolveModelName(
    settings: AzureApiSettings | OpenAIApiSettings,
): string | undefined {
    if (settings.modelName) {
        return settings.modelName;
    }
    const match = settings.endpoint?.match(/\/deployments\/([^/?]+)/i);
    return match?.[1];
}

/**
 * Look up the maximum completion (output) tokens for a model name. Returns
 * undefined for unknown models so callers can fall back to the deployment
 * default.
 */
function getModelMaxOutputTokens(
    modelName: string | undefined,
): number | undefined {
    if (!modelName) {
        return undefined;
    }
    const normalized = modelName.toLowerCase().replace(/_/g, "-");
    for (const [pattern, maxTokens] of MODEL_MAX_OUTPUT_TOKENS) {
        if (pattern.test(normalized)) {
            return maxTokens;
        }
    }
    return undefined;
}

/**
 * Parse the supported completion-token limit out of a service error such as
 * `max_tokens is too large: 16384. This model supports at most 4096 completion
 * tokens, whereas you provided 16384.` Returns the supported limit, or
 * undefined if the message isn't that error.
 */
function parseSupportedCompletionTokens(
    message: string | undefined,
): number | undefined {
    if (!message) {
        return undefined;
    }
    const match = message.match(
        /supports at most (\d+) completion tokens/i,
    );
    return match ? parseInt(match[1], 10) : undefined;
}

export function createChatModel(
    endpoint?: string | ApiSettings,
    completionSettings?: CompletionSettings,
    completionCallback?: (request: any, response: any) => void,
    tags?: string[],
): ChatModelWithStreaming {
    // Tag calls with the active mode so TokenCounter rollups can slice
    // by provider. Pre-resolved ApiSettings bypass mode override, so
    // only tag when the override is in effect AND the caller went
    // through name-based resolution.
    const activeMode = getActiveModelProvider();
    if (activeMode !== undefined && typeof endpoint !== "object") {
        tags = [...(tags ?? []), `mode:${activeMode}`];
    }
    const pool =
        typeof endpoint === "object"
            ? makeSingleMemberPool(endpoint, `custom:${endpoint.provider}`)
            : getChatModelPool(endpoint);
    const settings = pool.members[0].settings;

    // GPT-5 models only support temperature=1; 0 is rejected by the API.
    if (typeof endpoint === "string" && /gpt.?5/i.test(endpoint)) {
        completionSettings ??= {};
        completionSettings.temperature ??= 1;
    }

    if (settings.provider === "ollama") {
        return createOllamaChatModel(
            settings,
            completionSettings,
            completionCallback,
            tags,
        );
    }
    if (settings.provider === "copilot") {
        return createCopilotChatModel(
            settings,
            completionSettings,
            completionCallback,
            tags,
        );
    }
    return createAzureOpenAIChatModel(
        pool,
        completionSettings,
        completionCallback,
        tags,
    );
}

function createAzureOpenAIChatModel(
    pool: EndpointPool,
    completionSettings?: CompletionSettings,
    completionCallback?: (request: any, response: any) => void,
    tags?: string[],
) {
    // The preferred member's settings drive global behavior (response_format
    // support, model name for OpenAI, maxPromptChars). All members for a
    // single model name should have matching shape — they're the same model
    // in different regions.
    const settings = pool.members[0].settings as
        | AzureApiSettings
        | OpenAIApiSettings;
    completionSettings ??= {};
    completionSettings.n ??= 1;
    completionSettings.temperature ??= 0;

    // Normalize max_tokens → max_completion_tokens.  Newer models (GPT-5,
    // o3, o4, GPT-4.1, etc.) reject the legacy `max_tokens` parameter.
    // Promote it unconditionally — all supported models accept the new name.
    if (
        completionSettings.max_tokens !== undefined &&
        completionSettings.max_completion_tokens === undefined
    ) {
        completionSettings.max_completion_tokens =
            completionSettings.max_tokens;
    }
    delete completionSettings.max_tokens;

    // When the caller hasn't capped output, request the full output budget for
    // the selected model so large responses (e.g. knowledge extraction) aren't
    // silently truncated at the deployment default. Unknown models keep the
    // default (left unset).
    const resolvedModelName = resolveModelName(settings);
    if (completionSettings.max_completion_tokens === undefined) {
        const maxOutputTokens = getModelMaxOutputTokens(resolvedModelName);
        if (maxOutputTokens !== undefined) {
            completionSettings.max_completion_tokens = maxOutputTokens;
        }
    }

    const disableResponseFormat =
        !settings.supportsResponseFormat &&
        completionSettings.response_format !== undefined;
    if (disableResponseFormat) {
        // Remove it even if user specify it.
        delete completionSettings.response_format;
    }

    const defaultParams =
        settings.provider === "azure"
            ? {}
            : {
                  model: settings.modelName,
              };
    const model: ChatModelWithStreaming = {
        completionSettings,
        completionCallback,
        complete,
        completeStream,
    };
    return model;

    function buildRequest(params: any): BuildPoolRequest {
        return async (member) => {
            const headerResult = await createApiHeaders(member.settings);
            if (!headerResult.success) return headerResult;
            return success({ headers: headerResult.data, body: params });
        };
    }

    function getParams(
        messages: PromptSection[],
        jsonSchema?: CompletionJsonSchema,
        additionalParams?: any,
    ) {
        const params: any = {
            ...defaultParams,
            messages,
            ...completionSettings,
            ...additionalParams,
        };
        if (jsonSchema !== undefined) {
            if (disableResponseFormat) {
                throw new Error(
                    `Json schema not supported by model '${settings.modelName}'`,
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
    async function complete(
        prompt: string | PromptSection[],
        usageCallback?: CompleteUsageStatsCallback,
        jsonSchema?: CompletionJsonSchema,
        logFn?: (msg: any) => void,
        signal?: AbortSignal,
    ): Promise<Result<string>> {
        verifyPromptLength(settings, prompt);

        const messages: PromptSection[] =
            typeof prompt === "string"
                ? [{ role: "user", content: prompt }]
                : prompt;

        const params = getParams(messages, jsonSchema);
        let result = await callJsonApiWithPool(pool, buildRequest(params), {
            retryPauseMs: settings.retryPauseMs,
            signal,
        });
        if (!result.success) {
            // Adaptive output cap: some deployments support fewer completion
            // tokens than our requested budget and reject the request outright
            // (e.g. "max_tokens is too large: 16384. This model supports at most
            // 4096 completion tokens"). Parse the real limit, lower the cap for
            // this and future calls on this model, and retry once. Enabled by
            // default; callers can opt out via `adaptiveOutputTokens: false`.
            const supported =
                settings.adaptiveOutputTokens !== false
                    ? parseSupportedCompletionTokens(result.message)
                    : undefined;
            if (
                supported !== undefined &&
                completionSettings !== undefined &&
                completionSettings.max_completion_tokens !== supported
            ) {
                debugOpenAI(
                    "lowering max_completion_tokens from %s to %d for model %s per service limit",
                    completionSettings.max_completion_tokens ?? "<default>",
                    supported,
                    resolvedModelName ?? "<unknown>",
                );
                completionSettings.max_completion_tokens = supported;
                // Rebuild the request body so it reflects the lowered cap.
                params.max_completion_tokens = supported;
                result = await callJsonApiWithPool(pool, buildRequest(params), {
                    retryPauseMs: settings.retryPauseMs,
                    signal,
                });
            }
            if (!result.success) {
                return result;
            }
        }
        const data = result.data as ChatCompletion;
        if (!data.choices || data.choices.length === 0) {
            return error("No choices returned");
        }

        if (model.completionCallback) {
            model.completionCallback(params, data);
        }

        try {
            if (settings.enableModelRequestLogging && logFn) {
                // Log request
                logFn({
                    prompt: messages as PromptSection[],
                    response: data.choices[0].message?.content ?? "",
                    tokenUsage: data.usage,
                    tags: tags,
                });
            }
            // track token usage
            TokenCounter.getInstance().add(data.usage, tags);
            usageCallback?.(data.usage);
        } catch {}

        // Instrumentation: surface output size and truncation. The OpenAI/Azure
        // API reports a cut-off response via finish_reason === "length".
        const finishReason = data.choices[0].finish_reason;
        if (debugOpenAI.enabled) {
            debugOpenAI(
                "completion model=%s promptChars=%d promptTokens=%s completionTokens=%s maxCompletionTokens=%s finishReason=%s",
                resolvedModelName ?? "<unknown>",
                getPromptLength(prompt),
                data.usage?.prompt_tokens ?? "?",
                data.usage?.completion_tokens ?? "?",
                completionSettings?.max_completion_tokens ?? "<default>",
                finishReason ?? "<none>",
            );
        }
        if (finishReason === "length") {
            const maxTokens = completionSettings?.max_completion_tokens;
            return error(
                `Model output truncated (finish_reason="length"): generated ${
                    data.usage?.completion_tokens ?? "?"
                } completion token(s)${
                    maxTokens !== undefined
                        ? ` at max_completion_tokens=${maxTokens}`
                        : ""
                }. The response is incomplete; reduce the input size or raise the output token limit.`,
            );
        }

        if (Array.isArray(jsonSchema)) {
            const tool_calls = data.choices[0].message?.tool_calls;
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
        return success(data.choices[0].message?.content ?? "");
    }

    async function completeStream(
        prompt: string | PromptSection[],
        usageCallback?: CompleteUsageStatsCallback,
        jsonSchema?: CompletionJsonSchema,
        logFn?: (msg: any) => void,
        signal?: AbortSignal,
    ): Promise<Result<AsyncIterableIterator<string>>> {
        verifyPromptLength(settings, prompt);

        const messages: PromptSection[] =
            typeof prompt === "string"
                ? [{ role: "user", content: prompt }]
                : prompt;

        // BUGBUG - https://learn.microsoft.com/en-us/answers/questions/1805363/azure-openai-streaming-token-usage
        // image_url content with streaming token usage reporting is currently broken
        // TODO: remove after API endpoint correctly handles this case
        let historyIncludesImages: boolean = false;
        let isImageProptContent = (c: MultimodalPromptContent) =>
            (c as ImagePromptContent).type == "image_url";
        messages.map((ps) => {
            if (Array.isArray(ps.content)) {
                if (ps.content.some(isImageProptContent)) {
                    historyIncludesImages = true;
                }
            }
        });

        const params = getParams(messages, jsonSchema, {
            stream: true,
            stream_options: { include_usage: true && !historyIncludesImages },
        });
        const result = await callApiWithPool(pool, buildRequest(params), {
            retryPauseMs: settings.retryPauseMs,
            signal,
        });
        if (!result.success) {
            return result;
        }

        let fullResponseText = "";
        let tokenUsage;
        return {
            success: true,
            data: (async function* () {
                for await (const evt of readServerEventStream(
                    result.data,
                    signal,
                )) {
                    if (signal?.aborted) break;
                    if (evt.data === "[DONE]") {
                        try {
                            if (settings.enableModelRequestLogging && logFn) {
                                // Log request.
                                logFn({
                                    prompt: messages as PromptSection[],
                                    response: fullResponseText,
                                    tokenUsageData: tokenUsage,
                                    tags: tags,
                                });
                            }
                        } catch {}
                        if (Array.isArray(jsonSchema)) {
                            fullResponseText += "}";
                            yield "}";
                        }
                        break;
                    }
                    const data = JSON.parse(evt.data) as ChatCompletionChunk;
                    if (verifyContentSafety(data)) {
                        if (data.choices && data.choices.length > 0) {
                            if (Array.isArray(jsonSchema)) {
                                const delta = data.choices[0].delta.tool_calls;
                                if (delta) {
                                    for (const d of delta) {
                                        if (d.index !== 0) {
                                            throw new Error(
                                                "Invalid number of tool_calls",
                                            );
                                        }
                                        if (fullResponseText === "") {
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
                                            fullResponseText = `{"name":"${d.function.name}","arguments":${d.function.arguments ?? ""}`;
                                            yield fullResponseText;
                                        } else {
                                            const result = d.function.arguments;
                                            fullResponseText += result;
                                            yield result;
                                        }
                                    }
                                }
                            } else {
                                const delta = data.choices[0].delta.content;
                                if (delta) {
                                    fullResponseText += delta;
                                    yield delta;
                                }
                            }
                        }
                        if (data.usage) {
                            tokenUsage = data.usage;
                            try {
                                // track token usage
                                TokenCounter.getInstance().add(
                                    data.usage,
                                    tags,
                                );
                                usageCallback?.(data.usage);
                            } catch {}
                        }
                    }
                }
            })(),
        };
        // Stream chunks back
    }

    function verifyContentSafety(data: ChatCompletionChunk): boolean {
        data.choices.map((c: ChatCompletionDelta) => {
            if (c.finish_reason === "content_filter_error") {
                const err = c.content_filter_results as FilterError;
                throw new Error(
                    `There was a content filter error (${err.code}): ${err.message}`,
                );
            }

            verifyFilterResults(c.content_filter_results as FilterResult);
        });

        return true;
    }
}

function verifyFilterResults(filterResult: FilterResult) {
    let filters: string[] = new Array<string>();
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
            let msg = `A content filter has been triggered by one or more messages. The triggered filters are: ${filters.join(", ")}`;
            throw new Error(`${msg}`);
        }
    }
}

/**
 * Create one of AI System's standard Chat Models
 * @param modelName
 * @param tag - Tag for tracking this model's usage
 * @returns
 */
export function createChatModelDefault(tag: string): ChatModelWithStreaming {
    return createJsonChatModel(undefined, [tag]);
}

/**
 * Return a Chat model that returns JSON
 * Uses the type: json_object flag
 * @param endpoint
 * @param tags - Tags for tracking this model's usage
 * @param completionSettings Completion settings for the model
 * @returns ChatModel
 */
export function createJsonChatModel(
    endpoint?: string | ApiSettings,
    tags?: string[],
    completionSettings?: CompletionSettings,
): ChatModelWithStreaming {
    return createChatModel(
        endpoint,
        {
            response_format: { type: "json_object" },
            ...completionSettings,
        },
        undefined,
        tags,
    );
}

/**
 * Model that supports OpenAI api, but running locally
 * @param endpointName
 * @param completionSettings
 * @param tags - Tags for tracking this model's usage
 * @returns If no local Api settings found, return undefined
 */
export function createLocalChatModel(
    endpointName?: string,
    completionSettings?: CompletionSettings,
    tags?: string[],
): ChatModel | undefined {
    const settings = localOpenAIApiSettingsFromEnv(
        ModelType.Chat,
        undefined,
        endpointName,
        tags,
    );
    return settings
        ? createChatModel(settings, completionSettings, undefined, tags)
        : undefined;
}

export type AzureChatModelName =
    | "DEFAULT"
    | "GPT_4"
    | "GPT_35_TURBO"
    | "GPT_4_O"
    | "GPT_4_O_MINI"
    | "GPT_5"
    | "GPT_5_MINI"
    | "GPT_5_NANO"
    | "GPT_5_CHAT";

export const GPT_5: AzureChatModelName = "GPT_5";
export const GPT_5_NANO: AzureChatModelName = "GPT_5_NANO";
export const GPT_5_MINI: AzureChatModelName = "GPT_5_MINI";
export const GPT_5_CHAT: AzureChatModelName = "GPT_5_CHAT";

/**
 * Create a client for the OpenAI embeddings service
 * @param apiSettings: settings to use to create the client
 * @param dimensions (optional) text-embedding-03 and later models allow variable length embeddings
 */
export function createEmbeddingModel(
    endpoint: string,
    dimensions?: number | undefined,
): TextEmbeddingModel;
export function createEmbeddingModel(
    apiSettings?: ApiSettings | undefined,
    dimensions?: number | undefined,
): TextEmbeddingModel;
export function createEmbeddingModel(
    apiSettingsOrEndpoint?: ApiSettings | string | undefined,
    dimensions?: number | undefined,
): TextEmbeddingModel {
    let pool: EndpointPool;
    if (typeof apiSettingsOrEndpoint === "object") {
        pool = makeSingleMemberPool(
            apiSettingsOrEndpoint,
            `custom:${apiSettingsOrEndpoint.provider}`,
        );
    } else {
        const provider = defaultProvider();
        pool = getModelPool(
            provider,
            ModelType.Embedding,
            typeof apiSettingsOrEndpoint === "string"
                ? apiSettingsOrEndpoint
                : undefined,
        );
    }
    const settings = pool.members[0].settings;

    // https://platform.openai.com/docs/api-reference/embeddings/create#embeddings-create-input
    const maxBatchSize = 2048;
    const defaultParams: any =
        settings.provider === "azure"
            ? {}
            : {
                  model: settings.modelName,
              };
    if (dimensions && dimensions > 0) {
        defaultParams.dimensions = dimensions;
    }
    const model: TextEmbeddingModel = {
        generateEmbedding,
        generateEmbeddingBatch,
        maxBatchSize,
    };
    return model;

    async function generateEmbedding(input: string): Promise<Result<number[]>> {
        if (!input) {
            return error("Empty input");
        }
        const result = await callApi(input);
        if (!result.success) {
            return result;
        }
        const data = result.data as EmbeddingData;
        return success(data.data[0].embedding);
    }

    // Support optional method, since OAI supports batching
    async function generateEmbeddingBatch(
        input: string[],
    ): Promise<Result<number[][]>> {
        if (input.length === 0) {
            return error("Empty input array");
        }
        if (input.length > maxBatchSize) {
            return error(`Batch size must be < ${maxBatchSize}`);
        }
        const result = await callApi(input);
        if (!result.success) {
            return result;
        }
        const data = result.data as EmbeddingData;
        return success(data.data.map((d) => d.embedding));
    }

    async function callApi(input: string | string[]): Promise<Result<unknown>> {
        const params = {
            ...defaultParams,
            input,
        };
        return callJsonApiWithPool(
            pool,
            async (member) => {
                const headerResult = await createApiHeaders(member.settings);
                if (!headerResult.success) return headerResult;
                return success({ headers: headerResult.data, body: params });
            },
            { retryPauseMs: settings.retryPauseMs },
        );
    }

    type EmbeddingData = { data: { embedding: number[] }[] };
}

/**
 * Create a client for the OpenAI gpt-image-1.5 service
 * @param apiSettings: settings to use to create the client
 */
export function createImageModel(apiSettings?: ApiSettings): ImageModel {
    const pool = apiSettings
        ? makeSingleMemberPool(apiSettings, `custom:${apiSettings.provider}`)
        : getModelPool(defaultProvider(), ModelType.Image);
    const settings = pool.members[0].settings;
    const defaultParams =
        settings.provider === "azure"
            ? {}
            : {
                  model: settings.modelName,
              };
    const model: ImageModel = {
        generateImage,
        editImage,
    };
    return model;

    async function generateImage(
        prompt: string,
        imageCount: number,
        width: number,
        height: number,
    ): Promise<Result<ImageGeneration>> {
        if (imageCount != 1) {
            throw Error("n MUST equal 1"); // as of 10.03.2024 API will only accept n=1
        }
        const params = {
            ...defaultParams,
            prompt,
            n: imageCount,
            size: `${width}x${height}`,
            output_format: "png",
        };

        const result = await callJsonApiWithPool(
            pool,
            async (member) => {
                const headerResult = await createApiHeaders(member.settings);
                if (!headerResult.success) return headerResult;
                return success({ headers: headerResult.data, body: params });
            },
            { retryPauseMs: settings.retryPauseMs },
        );

        if (!result.success) {
            return result;
        }

        const data = result.data as ImageCompletion;
        const retValue: ImageGeneration = { images: [] };

        data.data.map((i) => {
            verifyContentSafety(i);
            const image_url = i.b64_json
                ? `data:image/png;base64,${i.b64_json}`
                : (i.url ?? "");
            retValue.images.push({
                revised_prompt: i.revised_prompt ?? prompt,
                image_url,
            });
        });

        return success(retValue);
    }

    async function editImage(
        sourceImage: Buffer,
        sourceMimeType: string,
        sourceFileName: string,
        prompt: string,
        imageCount: number,
        width: number,
        height: number,
    ): Promise<Result<ImageGeneration>> {
        if (imageCount !== 1) {
            throw Error("n MUST equal 1");
        }
        // Derive the edits URL from the configured generations URL.
        // Azure deployments expose `/images/generations` and a parallel
        // `/images/edits` on the same deployment path; preserve any
        // `?api-version=...` querystring.
        const member = pool.members[0];
        const generationsUrl = member.settings.endpoint;
        const editsUrl = generationsUrl.replace(
            "/images/generations",
            "/images/edits",
        );
        if (editsUrl === generationsUrl) {
            return error(
                `Configured image endpoint does not contain '/images/generations'; cannot derive edits URL: ${generationsUrl}`,
            );
        }

        const headerResult = await createApiHeaders(member.settings);
        if (!headerResult.success) {
            return headerResult;
        }
        // Strip Content-Type if present; let fetch set the multipart boundary.
        const headers: Record<string, string> = { ...headerResult.data };
        delete headers["Content-Type"];
        delete headers["content-type"];

        const form = new FormData();
        const blob = new Blob([sourceImage as unknown as ArrayBuffer], {
            type: sourceMimeType,
        });
        form.append("image", blob, sourceFileName);
        form.append("prompt", prompt);
        form.append("n", String(imageCount));
        form.append("size", `${width}x${height}`);
        if (member.settings.provider !== "azure" && settings.modelName) {
            form.append("model", settings.modelName);
        }

        let response: Response;
        try {
            response = await fetch(editsUrl, {
                method: "POST",
                headers,
                body: form,
            });
        } catch (e) {
            return error(`Image edit request failed: ${(e as Error).message}`);
        }
        if (!response.ok) {
            const body = await response.text().catch(() => "");
            return error(
                `Image edit request returned ${response.status} ${response.statusText}: ${body}`,
            );
        }
        const data = (await response.json()) as ImageCompletion;
        const retValue: ImageGeneration = { images: [] };
        data.data.map((i) => {
            verifyContentSafety(i);
            const image_url = i.b64_json
                ? `data:image/png;base64,${i.b64_json}`
                : (i.url ?? "");
            retValue.images.push({
                revised_prompt: i.revised_prompt ?? prompt,
                image_url,
            });
        });
        return success(retValue);
    }

    function verifyContentSafety(data: ImageData): boolean {
        verifyFilterResults(data.content_filter_results as FilterResult);
        verifyFilterResults(data.prompt_filter_results as FilterResult);

        return true;
    }
}

function verifyPromptLength(
    settings: ApiSettings,
    prompt: string | PromptSection[],
) {
    if (settings.provider !== "azure") {
        return;
    }
    const promptLength = getPromptLength(prompt);
    if (settings.maxPromptChars && settings.maxPromptChars > 0) {
        if (promptLength > settings.maxPromptChars) {
            const errorMsg = `REQUEST NOT SENT:\nTotal prompt length ${promptLength} chars EXCEEDS AZURE_OPENAI_MAX_CHARS=${settings.maxPromptChars}`;
            debugOpenAI(errorMsg);
            throw new Error(errorMsg);
        }
    } else if (promptLength > MAX_PROMPT_LENGTH_DEFAULT) {
        // Approx 20K tokens
        const errorMsg = `LARGE REQUEST:\nTotal prompt length ${promptLength} chars. Set AZURE_OPENAI_MAX_CHARS env variable to block.`;
        console.log(errorMsg);
        debugOpenAI(errorMsg);
    }
}

function getPromptLength(prompt: string | PromptSection[]) {
    if (typeof prompt === "string") {
        return prompt.length;
    }

    let length = 0;
    for (const section of prompt) {
        length += section.content.length;
    }
    return length;
}

/**
 * Create a client for the OpenAI sora model
 * @param apiSettings: settings to use to create the client
 */
export function createVideoModel(apiSettings?: ApiSettings): VideoModel {
    const pool = apiSettings
        ? makeSingleMemberPool(apiSettings, `custom:${apiSettings.provider}`)
        : getModelPool(defaultProvider(), ModelType.Video);
    const settings = pool.members[0].settings;
    const defaultParams =
        settings.provider === "azure"
            ? {}
            : {
                  model: settings.modelName,
              };
    const model: VideoModel = {
        generateVideo,
    };
    return model;

    async function generateVideo(
        prompt: string,
        numVariants: number = 1,
        durationInSeconds: 4 | 8 | 12 = 4,
        width: number = 1280,
        height: number = 720,
        inpaintItems?: ImageInPaintItem[],
    ): Promise<Result<VideoGenerationJob>> {
        if (numVariants < 0 || numVariants > 2) {
            throw Error("n MUST equal 1"); // as of 10.09.2025 API will only accept n<2
        }
        const params: VideoGenerationJob = {
            ...defaultParams,
            prompt,
            seconds: durationInSeconds,
            size: `${width}x${height}` as NonNullable<
                VideoGenerationJob["size"]
            >,
            model: "sora-2",
        };

        // file parameters
        const formData = new FormData();
        if (inpaintItems) {
            inpaintItems.forEach((item) => {
                // add the file contents to the form data
                const buffer = Buffer.from(item.contents!, "base64");
                const blob = new Blob([buffer], { type: item.mime_type! });

                formData.append("files", blob, item.file_name);

                // remove contents and mime type from the item, since we are sending the file
                delete item.contents;
                delete item.mime_type;

                // add the inpaint item to the form data
                params.input_reference?.push(item);
            });
        }

        // simple parameters
        for (const [k, v] of Object.entries(params)) {
            if (typeof v === "object") formData.append(k, JSON.stringify(v));
            else formData.append(k, v);
        }

        const response = await callApiWithPool(
            pool,
            async (member) => {
                const headerResult = await createApiHeaders(member.settings);
                if (!headerResult.success) return headerResult;
                return success({
                    headers: headerResult.data,
                    body: formData,
                });
            },
            { retryPauseMs: settings.retryPauseMs },
        );
        if (!response.success) return response;

        try {
            const jobJson = (await response.data.json()) as VideoGenerationJob;
            return success({
                endpoint: new URL(settings.endpoint),
                headers: {},
                ...jobJson,
            });
        } catch (err) {
            return error(`Error: ${err}`);
        }
    }
}
