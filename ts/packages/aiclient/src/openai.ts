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
} from "./models.js";
import { callApi, callJsonApi, FetchThrottler } from "./restClient.js";
import { getEnvSetting } from "./common.js";
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
import { PromptLogger } from "./promptLogger.js";
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

export { azureApiSettingsFromEnv };

const debugOpenAI = registerDebug("typeagent:openai");

export enum ModelType {
    Chat = "chat",
    Embedding = "embedding",
    Image = "image",
}

export type ModelInfo<T> = {
    type: ModelType;
    model: T;
    endpointName?: string;
    maxTokens: number;
};

export type ModelProviders = "openai" | "azure" | "ollama";

export type CommonApiSettings = {
    provider: ModelProviders;
    modelType: ModelType;
    endpoint: string;
    maxRetryAttempts?: number;
    retryPauseMs?: number;
    maxConcurrency?: number | undefined;
    throttler?: FetchThrottler;
    enableModelRequestLogging?: boolean | undefined;
};
/**
 * Settings used by OpenAI clients
 */
export type ApiSettings =
    | OllamaApiSettings
    | AzureApiSettings
    | OpenAIApiSettings;

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
    AZURE_OPENAI_MAX_CHARS = "AZURE_OPENAI_MAX_CHARS",

    AZURE_OPENAI_API_KEY_EMBEDDING = "AZURE_OPENAI_API_KEY_EMBEDDING",
    AZURE_OPENAI_ENDPOINT_EMBEDDING = "AZURE_OPENAI_ENDPOINT_EMBEDDING",

    AZURE_OPENAI_API_KEY_DALLE = "AZURE_OPENAI_API_KEY_DALLE",
    AZURE_OPENAI_ENDPOINT_DALLE = "AZURE_OPENAI_ENDPOINT_DALLE",

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
        return {
            provider:
                EnvVars.OPENAI_ENDPOINT in process.env ? "openai" : "azure",
        };
    }
    if (
        endpoint === "openai" ||
        endpoint === "azure" ||
        endpoint === "ollama"
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
    if (EnvVars.OPENAI_ENDPOINT in process.env) {
        return { provider: "openai", name: endpoint };
    }
    return { provider: "azure", name: endpoint };
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
            : endpointName.provider === "azure"
              ? azureApiSettingsFromEnv
              : ollamaApiSettingsFromEnv;
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
    revised_prompt: string;
    url: string;
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
export function createChatModel(
    endpoint?: string | ApiSettings,
    completionSettings?: CompletionSettings,
    completionCallback?: (request: any, response: any) => void,
    tags?: string[],
): ChatModelWithStreaming {
    const settings =
        typeof endpoint === "object"
            ? endpoint
            : getChatModelSettings(endpoint);

    if (settings.provider === "ollama") {
        return createOllamaChatModel(
            settings,
            completionSettings,
            completionCallback,
            tags,
        );
    }
    return createAzureOpenAIChatModel(
        settings,
        completionSettings,
        completionCallback,
        tags,
    );
}

function createAzureOpenAIChatModel(
    settings: AzureApiSettings | OpenAIApiSettings,
    completionSettings?: CompletionSettings,
    completionCallback?: (request: any, response: any) => void,
    tags?: string[],
) {
    completionSettings ??= {};
    completionSettings.n ??= 1;
    completionSettings.temperature ??= 0;

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
    ): Promise<Result<string>> {
        verifyPromptLength(settings, prompt);

        const headerResult = await createApiHeaders(settings);
        if (!headerResult.success) {
            return headerResult;
        }

        const messages: PromptSection[] =
            typeof prompt === "string"
                ? [{ role: "user", content: prompt }]
                : prompt;

        const params = getParams(messages, jsonSchema);
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

        if (model.completionCallback) {
            model.completionCallback(params, data);
        }

        try {
            if (settings.enableModelRequestLogging) {
                // Log request
                PromptLogger.getInstance().logModelRequest({
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
    ): Promise<Result<AsyncIterableIterator<string>>> {
        verifyPromptLength(settings, prompt);

        const headerResult = await createApiHeaders(settings);
        if (!headerResult.success) {
            return headerResult;
        }

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

        let fullResponseText = "";
        let tokenUsage;
        return {
            success: true,
            data: (async function* () {
                for await (const evt of readServerEventStream(result.data)) {
                    if (evt.data === "[DONE]") {
                        try {
                            if (settings.enableModelRequestLogging) {
                                // Log request.
                                PromptLogger.getInstance().logModelRequest({
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
 * @returns ChatModel
 */
export function createJsonChatModel(
    endpoint?: string | ApiSettings,
    tags?: string[],
): ChatModelWithStreaming {
    return createChatModel(
        endpoint,
        {
            response_format: { type: "json_object" },
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
    | "GPT_4_O_MINI";

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
    if (typeof apiSettingsOrEndpoint === "string") {
        apiSettingsOrEndpoint = apiSettingsFromEnv(
            ModelType.Embedding,
            undefined,
            apiSettingsOrEndpoint,
        );
    }
    // https://platform.openai.com/docs/api-reference/embeddings/create#embeddings-create-input
    const maxBatchSize = 2048;
    const settings =
        apiSettingsOrEndpoint ?? apiSettingsFromEnv(ModelType.Embedding);
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
        const headerResult = await createApiHeaders(settings);
        if (!headerResult.success) {
            return headerResult;
        }
        const params = {
            ...defaultParams,
            input,
        };

        return callJsonApi(
            headerResult.data,
            settings.endpoint,
            params,
            settings.maxRetryAttempts,
            settings.retryPauseMs,
        );
    }

    type EmbeddingData = { data: { embedding: number[] }[] };
}

/**
 * Create a client for the OpenAI image/DallE service
 * @param apiSettings: settings to use to create the client
 */
export function createImageModel(apiSettings?: ApiSettings): ImageModel {
    const settings = apiSettings ?? apiSettingsFromEnv(ModelType.Image);
    const defaultParams =
        settings.provider === "azure"
            ? {}
            : {
                  model: settings.modelName,
              };
    const model: ImageModel = {
        generateImage,
    };
    return model;

    async function generateImage(
        prompt: string,
        imageCount: number,
        width: number,
        height: number,
    ): Promise<Result<ImageGeneration>> {
        const headerResult = await createApiHeaders(settings);
        if (!headerResult.success) {
            return headerResult;
        }
        if (imageCount != 1) {
            throw Error("n MUST equal 1"); // as of 10.03.2024 API will only accept n=1
        }
        const params = {
            ...defaultParams,
            prompt,
            n: imageCount,
            size: `${width}x${height}`,
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

        const data = result.data as ImageCompletion;
        const retValue: ImageGeneration = { images: [] };

        data.data.map((i) => {
            verifyContentSafety(i);
            retValue.images.push({
                revised_prompt: i.revised_prompt,
                image_url: i.url,
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
