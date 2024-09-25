// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    TextEmbeddingModel,
    CompletionSettings,
    ChatModel,
    ChatMessage,
    ChatModelWithStreaming,
} from "./models";
import { FetchThrottler, callApi, callJsonApi } from "./restClient";
import { getEnvSetting } from "./common";
import {
    PromptSection,
    Result,
    success,
    error,
    TypeChatLanguageModel,
} from "typechat";
import { readServerEventStream } from "./serverEvents";
import { priorityQueue } from "async";
import {
    AuthTokenProvider,
    AzureTokenScopes,
    createAzureTokenProvider,
} from "./auth";

const IdentityApiKey = "identity";

export enum ModelType {
    Chat = "chat",
    Embedding = "embedding",
}

export type ModelInfo<T> = {
    type: ModelType;
    model: T;
    endpointName?: string;
    maxTokens: number;
};

/**
 * Settings used by OpenAI clients
 */
export type ApiSettings = {
    isAzure: boolean; // calling an Azure Open API endpoint
    modelType: ModelType;
    endpoint: string;
    apiKey: string;
    modelName?: string;
    organization?: string;
    maxRetryAttempts?: number;
    retryPauseMs?: number;
    supportsResponseFormat?: boolean; // only apply to chat models
    maxConcurrency?: number | undefined;
    throttler?: FetchThrottler;
    azureSettings?: AzureApiSettings | undefined;
};

export type AzureApiSettings = {
    tokenProvider?: AuthTokenProvider;
};

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
    OPENAI_MODEL_EMBEDDING = "OPENAI_MODEL_EMBEDDING",

    AZURE_OPENAI_API_KEY = "AZURE_OPENAI_API_KEY",
    AZURE_OPENAI_ENDPOINT = "AZURE_OPENAI_ENDPOINT",
    AZURE_OPENAI_RESPONSE_FORMAT = "AZURE_OPENAI_RESPONSE_FORMAT",
    AZURE_OPENAI_MAX_CONCURRENCY = "AZURE_OPENAI_MAX_CONCURRENCY",

    AZURE_OPENAI_API_KEY_EMBEDDING = "AZURE_OPENAI_API_KEY_EMBEDDING",
    AZURE_OPENAI_ENDPOINT_EMBEDDING = "AZURE_OPENAI_ENDPOINT_EMBEDDING",
}

/**
 * Initialize settings from environment variables
 * @param modelType
 * @param env Environment variables or arbitrary Record
 * @param endpointName optional suffix to add to env variable names. Lets you target different backends
 * @returns
 */
export function apiSettingsFromEnv(
    modelType: ModelType = ModelType.Chat,
    env?: Record<string, string | undefined>,
    endpointName?: string,
): ApiSettings {
    env ??= process.env;
    if (EnvVars.OPENAI_API_KEY in env) {
        return openAIApiSettingsFromEnv(modelType, env, endpointName);
    }

    return azureApiSettingsFromEnv(modelType, env, endpointName);
}

/**
 * Load settings for the OpenAI services from env
 * @param modelType Chat or Embedding
 * @param env Environment variables
 * @param endpointName Name of endpoint, e.g. GPT_35_TURBO or PHI3. This is appended as a suffix to base environment key
 * @param requireEndpoint If false (default), falls back to using non-endpoint specific settings
 * @returns
 */

export function openAIApiSettingsFromEnv(
    modelType: ModelType,
    env?: Record<string, string | undefined>,
    endpointName?: string,
    requireEndpoint: boolean = false,
): ApiSettings {
    env ??= process.env;
    return {
        isAzure: false,
        modelType: modelType,
        apiKey: getEnvSetting(env, EnvVars.OPENAI_API_KEY, endpointName),
        endpoint: getEnvSetting(
            env,
            modelType === ModelType.Chat
                ? EnvVars.OPENAI_ENDPOINT
                : EnvVars.OPENAI_ENDPOINT_EMBEDDING,
            endpointName,
            undefined,
            requireEndpoint,
        ),
        modelName: getEnvSetting(
            env,
            modelType === ModelType.Chat
                ? EnvVars.OPENAI_MODEL
                : EnvVars.OPENAI_MODEL_EMBEDDING,
            endpointName,
        ),
        organization: getEnvSetting(
            env,
            EnvVars.OPENAI_ORGANIZATION,
            endpointName,
        ),
        supportsResponseFormat:
            getEnvSetting(
                env,
                EnvVars.OPENAI_RESPONSE_FORMAT,
                endpointName,
                "0",
            ) === "1",
        maxConcurrency: getMaxConcurrencyFromEnv(
            env,
            EnvVars.OPENAI_MAX_CONCURRENCY,
            endpointName,
        ),
    };
}
const azureTokenProvider = createAzureTokenProvider(
    AzureTokenScopes.CogServices,
);
/**
 * Load settings for the Azure OpenAI services from env
 * @param modelType
 * @param env
 * @returns
 */
export function azureApiSettingsFromEnv(
    modelType: ModelType,
    env?: Record<string, string | undefined>,
    endpointName?: string,
): ApiSettings {
    env ??= process.env;
    const settings =
        modelType == ModelType.Chat
            ? azureChatApiSettingsFromEnv(env, endpointName)
            : azureEmbeddingApiSettingsFromEnv(env, endpointName);

    if (settings.apiKey.toLowerCase() === IdentityApiKey) {
        settings.azureSettings = {
            tokenProvider: azureTokenProvider,
        };
    }

    return settings;
}

/**
 * Load settings for the Azure OpenAI Chat Api from env
 * @param env
 * @returns
 */
function azureChatApiSettingsFromEnv(
    env: Record<string, string | undefined>,
    endpointName?: string,
): ApiSettings {
    return {
        isAzure: true,
        modelType: ModelType.Chat,
        apiKey: getEnvSetting(env, EnvVars.AZURE_OPENAI_API_KEY, endpointName),
        endpoint: getEnvSetting(
            env,
            EnvVars.AZURE_OPENAI_ENDPOINT,
            endpointName,
        ),
        supportsResponseFormat:
            getEnvSetting(
                env,
                EnvVars.AZURE_OPENAI_RESPONSE_FORMAT,
                endpointName,
                "0",
            ) === "1",
        maxConcurrency: getMaxConcurrencyFromEnv(
            env,
            EnvVars.AZURE_OPENAI_MAX_CONCURRENCY,
            endpointName,
        ),
    };
}

function getMaxConcurrencyFromEnv(
    env: Record<string, string | undefined>,
    envName: string,
    endpointName?: string,
) {
    const maxConcurrencyEnv = getEnvSetting(env, envName, endpointName, "");
    const maxConcurrency = maxConcurrencyEnv
        ? parseInt(maxConcurrencyEnv)
        : undefined;

    if (
        maxConcurrency !== undefined &&
        (maxConcurrency.toString() !== maxConcurrencyEnv || maxConcurrency <= 0)
    ) {
        throw new Error(`Invalid value for ${envName}: ${maxConcurrencyEnv}`);
    }
    return maxConcurrency;
}

/**
 * Load settings for the Azure OpenAI Embedding service from env
 * @param env
 * @returns
 */
function azureEmbeddingApiSettingsFromEnv(
    env: Record<string, string | undefined>,
    endpointName?: string,
): ApiSettings {
    return {
        isAzure: true,
        modelType: ModelType.Embedding,
        apiKey: getEnvSetting(
            env,
            EnvVars.AZURE_OPENAI_API_KEY_EMBEDDING,
            endpointName,
        ),
        endpoint: getEnvSetting(
            env,
            EnvVars.AZURE_OPENAI_ENDPOINT_EMBEDDING,
            endpointName,
        ),
    };
}

/**
 * Loads settings that support local services supporting the Open AI API spec
 * @param modelType Type of setting
 * @param env Environment variables
 * @param endpointName
 * @returns API settings, or undefined if endpoint was not defined
 */
export function localOpenAIApiSettingsFromEnv(
    modelType: ModelType,
    env?: Record<string, string | undefined>,
    endpointName?: string,
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
    if (settings.isAzure) {
        if (settings.azureSettings?.tokenProvider) {
            const tokenResult =
                await settings.azureSettings.tokenProvider.getAccessToken();
            if (!tokenResult.success) {
                return tokenResult;
            }
            apiHeaders = {
                Authorization: `Bearer ${tokenResult.data}`,
            };
        } else {
            apiHeaders = { "api-key": settings.apiKey };
        }
    } else {
        apiHeaders = {
            Authorization: `Bearer ${settings.apiKey}`,
            "OpenAI-Organization": settings.organization ?? "",
        };
    }
    return success(apiHeaders);
}

// Statistics returned by the OAI api
export type CompletionUsageStats = {
    // Number of tokens in the generated completion
    completion_tokens: number;
    // Number of tokens in the prompt
    prompt_tokens: number;
    // Total tokens (prompt + completion)
    total_tokens: number;
};

// Parse the endpoint name with the following naming conventions
//
// - By default, if endpoint name is not specified, it defaults to `OPENAI_ENDPOINT` if it exists, and `AZURE_OPENAI_ENDPOINT` otherwise.
// - Endpoint names `azure` and `openai` refers to `AZURE_OPENAI_ENDPOINT` and `OPENAI_ENDPOINT`
// - Endpoint names `azure:<name>` and `openai:<name>` refers to `AZURE_OPENAI_ENDPOINT_<name>` and `OPENAI_ENDPOINT_<name>`
// - Endpoint names without the `azure:` or `openai:` prefix will assume it is prefixed with `azure:` and uses `AZURE_OPENAI_ENDPOINT_<name>`

function parseEndPointName(endpoint?: string) {
    if (endpoint === undefined || endpoint === "") {
        return {
            provider:
                EnvVars.OPENAI_ENDPOINT in process.env ? "openai" : "azure",
        };
    }
    if (endpoint === "openai" || endpoint === "azure") {
        return { provider: endpoint };
    }
    if (endpoint.startsWith("openai:")) {
        return { provider: "openai", name: endpoint.substring(7) };
    }
    if (EnvVars.OPENAI_ENDPOINT in process.env) {
        return { provider: "openai", name: endpoint };
    }
    return {
        provider: "azure",
        name: endpoint.startsWith("azure:") ? endpoint.substring(6) : endpoint,
    };
}

// Cache of the model settings
const chatModels = new Map<string, ApiSettings>();
export function getChatModelSettings(endpoint?: string) {
    const endpointName = parseEndPointName(endpoint);
    const endpointKey = `${endpointName.provider}:${endpointName.name}`;
    const existing = chatModels.get(endpointKey);
    if (existing) {
        return existing;
    }

    const getApiSettingsFromEnv =
        endpointName.provider === "openai"
            ? openAIApiSettingsFromEnv
            : azureApiSettingsFromEnv;
    const settings = getApiSettingsFromEnv(
        ModelType.Chat,
        undefined,
        endpointName.name,
    );

    if (settings.maxConcurrency !== undefined) {
        const q = priorityQueue<() => Promise<any>>(async (task) => {
            return task();
        }, settings.maxConcurrency);

        const throttler = (fn: () => Promise<any>, priority?: number) => {
            return q.push<any>(fn, priority);
        };

        settings.throttler = throttler;
    }

    chatModels.set(endpointKey, settings);
    return settings;
}

export function supportsStreaming(
    model: TypeChatLanguageModel,
): model is ChatModelWithStreaming {
    return "completeStream" in model;
}

type FilterContentResult = {
    hate?: FilterResult,
    self_harm?: FilterResult,
    sexual?: FilterResult,
    violence?: FilterResult,
    error?: FilterError,
};

type FilterError = {
    code: string,
    message: string,
}

type FilterResult = {
    filtered: boolean,
    severity: string,
}

// NOTE: these are not complete
type ChatCompletion = {
    id: string;
    choices: ChatCompletionChoice[];
};

type ChatCompletionChoice = {
    message?: ChatContent;
    content_filter_results?: FilterContentResult | ContentFilterError,
    finish_reason?: string,
}

type ChatCompletionChunk = {
    id: string;
    choices: ChatCompletionDelta[];
};

type ChatCompletionDelta = {
    delta: ChatContent;
    content_filter_results?: FilterContentResult | ContentFilterError,
    finish_reason?: string,
}

type ChatContent = {
    content?: string | null;
    role: "assistant";
}

type ContentFilterError = {
    code: string;
    message: string;
}

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
 * @returns ChatModel
 */
export function createChatModel(
    endpoint?: string | ApiSettings,
    completionSettings?: CompletionSettings,
    responseCallback?: (request: any, response: any) => void,
): ChatModelWithStreaming {
    const settings =
        typeof endpoint === "object"
            ? endpoint
            : getChatModelSettings(endpoint);

    completionSettings ??= {};
    completionSettings.n ??= 1;
    completionSettings.temperature ??= 0;
    if (!settings.supportsResponseFormat) {
        // Remove it even if user specify it.
        delete completionSettings.response_format;
    }

    const defaultParams = settings.isAzure
        ? {}
        : {
              model: settings.modelName,
          };
    const model: ChatModelWithStreaming = {
        completionSettings: completionSettings,
        complete,
        completeStream,
    };
    return model;

    async function complete(
        prompt: string | PromptSection[] | ChatMessage[],
    ): Promise<Result<string>> {
        const headerResult = await createApiHeaders(settings);
        if (!headerResult.success) {
            return headerResult;
        }

        const messages =
            typeof prompt === "string"
                ? [{ role: "user", content: prompt }]
                : prompt;

        const params = {
            ...defaultParams,
            messages: messages,
            ...completionSettings,
        };

        const result = await callJsonApi(
            headerResult.data,
            settings.endpoint,
            params,
            settings.maxRetryAttempts,
            settings.retryPauseMs,
            undefined,
            settings.throttler,
        );
        if (!result.success) {
            return result;
        }

        const data = result.data as ChatCompletion;
        if (!data.choices || data.choices.length === 0) {
            return error("No choices returned");
        }

        if (responseCallback) {
            responseCallback(params, data);
        }

        return success(data.choices[0].message?.content ?? "");
    }

    async function completeStream(
        prompt: string | PromptSection[] | ChatMessage[],
    ): Promise<Result<AsyncIterableIterator<string>>> {
        const headerResult = await createApiHeaders(settings);
        if (!headerResult.success) {
            return headerResult;
        }

        const messages =
            typeof prompt === "string"
                ? [{ role: "user", content: prompt }]
                : prompt;

        let completionParams: CompletionSettings | undefined;
        if (completionSettings) {
            completionParams = { ...completionSettings };
        }
        const params = {
            ...defaultParams,
            messages: messages,
            stream: true,
            ...completionParams,
        };
        const result = await callApi(
            headerResult.data,
            settings.endpoint,
            params,
            settings.maxRetryAttempts,
            settings.retryPauseMs,
        );
        if (!result.success) {
            return result;
        }
        return {
            success: true,
            data: (async function* () {
                for await (const evt of readServerEventStream(result.data)) {
                    if (evt.data === "[DONE]") {
                        break;
                    }
                    const data = JSON.parse(evt.data) as ChatCompletionChunk;
                    if (verifyContentIsSafe(data)) {
                        if (data.choices && data.choices.length > 0) {
                            const delta = data.choices[0].delta?.content ?? "";
                            if (delta) {
                                yield delta;
                            }
                        }
                    }
                }
            })(),
        };
        // Stream chunks back
    }

    function verifyContentIsSafe(data: ChatCompletionChunk): boolean {
            
        let filters: string[] = new Array<string>();

        data.choices.map((c: ChatCompletionDelta) => {
            if (c.finish_reason == "content_filter_error") {
                const err = c.content_filter_results as ContentFilterError;
                throw new Error(`There was a content filter error (${err.code}): ${err.message}`);
            }

            const cfr = c.content_filter_results as FilterContentResult;
            if (cfr) {
                    if (cfr?.hate?.filtered) {
                        filters.push("hate");
                    }
                    if (cfr?.self_harm?.filtered) {
                        filters.push("self_harm");
                    }
                    if (cfr?.sexual?.filtered) {
                        filters.push("sexual");
                    }
                    if (cfr?.violence?.filtered) {
                        filters.push("violence");
                    }

                if (filters.length > 0) {
                    let msg = `A content filter has been triggered by one or more messages. The triggered filters are: ${filters.join(", ")}`;
                    throw new Error(`${msg}`);
                }
            }
        });

        return true;
    }
}

/**
 * Return a Chat model that returns JSON
 * Uses the type: json_object flag
 * @param endpoint
 * @returns ChatModel
 */
export function createJsonChatModel(
    endpoint?: string | ApiSettings,
): ChatModel {
    return createChatModel(endpoint, {
        response_format: { type: "json_object" },
    });
}

/**
 * Model that supports OpenAI api, but running locally
 * @param endpointName
 * @param completionSettings
 * @returns If no local Api settings found, return undefined
 */
export function createLocalChatModel(
    endpointName?: string,
    completionSettings?: CompletionSettings,
): ChatModel | undefined {
    const settings = localOpenAIApiSettingsFromEnv(
        ModelType.Chat,
        undefined,
        endpointName,
    );
    return settings ? createChatModel(settings, completionSettings) : undefined;
}

export type AzureChatModelName = "GPT_4" | "GPT_35_TURBO" | "GPT_4_O";
/**
 * Create one of AI System's standard Chat Models
 * @param modelName
 * @returns
 */
export function createStandardAzureChatModel(
    modelName: AzureChatModelName,
): ChatModel {
    const endpointName = modelName === "GPT_4" ? undefined : modelName; // GPT_4 is the default model
    return createJsonChatModel(endpointName);
}

/**
 * Create a client for the OpenAI embeddings service
 * @param apiSettings: settings to use to create the client
 */
export function createEmbeddingModel(
    apiSettings?: ApiSettings,
): TextEmbeddingModel {
    const settings = apiSettings ?? apiSettingsFromEnv(ModelType.Embedding);
    const defaultParams = settings.isAzure
        ? {}
        : {
              model: settings.modelName,
          };
    const model: TextEmbeddingModel = {
        generateEmbedding,
    };
    return model;

    async function generateEmbedding(input: string): Promise<Result<number[]>> {
        const headerResult = await createApiHeaders(settings);
        if (!headerResult.success) {
            return headerResult;
        }
        const params = {
            ...defaultParams,
            input,
        };

        const result = await callJsonApi(
            headerResult.data,
            settings.endpoint,
            params,
            settings.maxRetryAttempts,
            settings.retryPauseMs,
        );
        if (!result.success) {
            return result;
        }

        const data = result.data as { data: { embedding: number[] }[] };

        return success(data.data[0].embedding);
    }
}
