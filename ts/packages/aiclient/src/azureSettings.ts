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
    const settings =
        modelType == ModelType.Chat
            ? azureChatApiSettingsFromEnv(env, endpointName)
            : modelType == ModelType.Image
              ? azureImageApiSettingsFromEnv(env, endpointName)
              : azureEmbeddingApiSettingsFromEnv(env, endpointName);

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
        maxConcurrency: getIntFromEnv(
            env,
            EnvVars.AZURE_OPENAI_MAX_CONCURRENCY,
            endpointName,
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
        ),
        endpoint: getEnvSetting(
            env,
            EnvVars.AZURE_OPENAI_ENDPOINT_DALLE,
            endpointName,
        ),
    };
}
