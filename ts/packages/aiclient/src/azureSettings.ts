// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AuthTokenProvider,
    AzureTokenScopes,
    createAzureTokenProvider,
} from "./auth.js";
import { getEnvSetting, getIntFromEnv } from "./common.js";
import { CommonApiSettings, EnvVars, ModelType } from "./openai.js";
import { azureApiSettingsFromConfig } from "./apiSettingsFromConfig.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import registerDebug from "debug";

const debugSettings = registerDebug("typeagent:aiclient:azureSettings");

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
 *
 * @deprecated Use `azureApiSettingsFromConfig` from
 * `./apiSettingsFromConfig.ts` instead. This function now consults
 * the typed `@typeagent/config` runtime config before falling back
 * to the legacy env scan, so existing callers keep working — but
 * new code should take a `Config` and call the typed entry point
 * directly.
 */
export function azureApiSettingsFromEnv(
    modelType: ModelType,
    env?: Record<string, string | undefined>,
    endpointName?: string,
): AzureApiSettings {
    // Prefer the typed-config path when the caller hasn't supplied a custom
    // env map. This lets YAML-only configurations (where only suffixed
    // deployments are defined) satisfy bare lookups via the synthesized
    // service defaults, instead of throwing `Missing ApiSetting:
    // AZURE_OPENAI_ENDPOINT`. When the caller passes an explicit `env`,
    // honor it and use the legacy env-scan path unchanged.
    if (env === undefined) {
        try {
            return azureApiSettingsFromConfig(
                getRuntimeConfig(),
                modelType,
                endpointName?.toLowerCase(),
            );
        } catch (e) {
            debugSettings(
                "typed-config lookup failed for %s/%s, falling back to env: %s",
                modelType,
                endpointName ?? "<default>",
                (e as Error).message,
            );
            // fall through to legacy env scan
        }
    }

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
            EnvVars.AZURE_OPENAI_API_KEY_GPT_IMAGE_1_5,
            endpointName,
            env[EnvVars.AZURE_OPENAI_API_KEY_GPT_IMAGE] ?? "identity",
        ),
        endpoint: getEnvSetting(
            env,
            EnvVars.AZURE_OPENAI_ENDPOINT_GPT_IMAGE_1_5,
            endpointName,
            env[EnvVars.AZURE_OPENAI_ENDPOINT_GPT_IMAGE],
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
            EnvVars.AZURE_OPENAI_API_KEY_SORA_2,
            endpointName,
            "identity",
        ),
        endpoint: getEnvSetting(
            env,
            EnvVars.AZURE_OPENAI_ENDPOINT_SORA_2,
            endpointName,
        ),
    };
}
