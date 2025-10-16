// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AuthTokenProvider,
    AzureTokenScopes,
    createAzureTokenProvider,
} from "./auth.js";
import { getEnvSetting, getIntFromEnv } from "./common.js";
import { CommonApiSettings, EnvVars, ModelType } from "./openai.js";

export type AzureApiSettings = CommonApiSettings & {
    provider: "azure";

    apiKey: string;
    modelName?: string;
    supportsResponseFormat?: boolean; // only apply to chat models
    tokenProvider?: AuthTokenProvider;
    maxPromptChars?: number | undefined; // Maximum # of allowed prompt chars to send
};

const IdentityApiKey = "identity";
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
): AzureApiSettings {
    env ??= process.env;

    let settings: AzureApiSettings | undefined;

    switch (modelType) {
        case ModelType.Chat:
            settings = azureChatApiSettingsFromEnv(env, endpointName);
            break;
        case ModelType.Image:
            settings = azureImageApiSettingsFromEnv(env, endpointName);
            break;
        case ModelType.Video:
            settings = azureVideoApiSettingsFromEnv(env, endpointName);
            break;
        default:
            settings = azureEmbeddingApiSettingsFromEnv(env, endpointName);
            break;
    }

    if (settings.apiKey.toLowerCase() === IdentityApiKey) {
        settings.tokenProvider = azureTokenProvider;
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
): AzureApiSettings {
    return {
        provider: "azure",
        modelType: ModelType.Chat,
        apiKey: getEnvSetting(
            env,
            EnvVars.AZURE_OPENAI_API_KEY,
            endpointName,
            "identity",
        ),
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
        maxConcurrency: getIntFromEnv(
            env,
            EnvVars.AZURE_OPENAI_MAX_CONCURRENCY,
            endpointName,
        ),
        timeout: getIntFromEnv(
            env,
            EnvVars.AZURE_OPENAI_MAX_TIMEOUT,
            endpointName,
            60_000,
        ),
        maxRetryAttempts: getIntFromEnv(
            env,
            EnvVars.AZURE_OPENAI_MAX_RETRYATTEMPTS,
            endpointName,
            3,
        ),
        maxPromptChars: getIntFromEnv(
            env,
            EnvVars.AZURE_OPENAI_MAX_CHARS,
            endpointName,
        ),
        enableModelRequestLogging:
            getEnvSetting(
                env,
                EnvVars.ENABLE_MODEL_REQUEST_LOGGING,
                undefined,
                "false",
            ) === "true",
    };
}

/**
 * Load settings for the Azure OpenAI Embedding service from env
 * @param env
 * @returns
 */
function azureEmbeddingApiSettingsFromEnv(
    env: Record<string, string | undefined>,
    endpointName?: string,
): AzureApiSettings {
    return {
        provider: "azure",
        modelType: ModelType.Embedding,
        apiKey: getEnvSetting(
            env,
            EnvVars.AZURE_OPENAI_API_KEY_EMBEDDING,
            endpointName,
            "identity",
        ),
        endpoint: getEnvSetting(
            env,
            EnvVars.AZURE_OPENAI_ENDPOINT_EMBEDDING,
            endpointName,
        ),
    };
}

/**
 * Load settings for the Azure OpenAI Image service from env
 * @param env
 * @returns
 */
function azureImageApiSettingsFromEnv(
    env: Record<string, string | undefined>,
    endpointName?: string,
): AzureApiSettings {
    return {
        provider: "azure",
        modelType: ModelType.Image,
        apiKey: getEnvSetting(
            env,
            EnvVars.AZURE_OPENAI_API_KEY_DALLE,
            endpointName,
            "identity",
        ),
        endpoint: getEnvSetting(
            env,
            EnvVars.AZURE_OPENAI_ENDPOINT_DALLE,
            endpointName,
        ),
    };
}

/**
 * Load settings for the Azure OpenAI Video service from env
 * @param env
 * @returns
 */
function azureVideoApiSettingsFromEnv(
    env: Record<string, string | undefined>,
    endpointName?: string,
): AzureApiSettings {
    return {
        provider: "azure",
        modelType: ModelType.Image,
        apiKey: getEnvSetting(
            env,
            EnvVars.AZURE_OPENAI_API_KEY_SORA,
            endpointName,
            "identity",
        ),
        endpoint: getEnvSetting(
            env,
            EnvVars.AZURE_OPENAI_ENDPOINT_SORA,
            endpointName,
        ),
    };
}
