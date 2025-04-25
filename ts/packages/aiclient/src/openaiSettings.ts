// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommonApiSettings, EnvVars } from "./openai.js";
import { getEnvSetting, getIntFromEnv } from "./common.js";
import { ModelType } from "./openai.js";

export type OpenAIApiSettings = CommonApiSettings & {
    provider: "openai";

    apiKey: string;
    modelName?: string;
    organization?: string;
    supportsResponseFormat?: boolean; // only apply to chat models
};

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
): OpenAIApiSettings {
    env ??= process.env;
    return {
        provider: "openai",
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
        maxConcurrency: getIntFromEnv(
            env,
            EnvVars.OPENAI_MAX_CONCURRENCY,
            endpointName,
        ),
        enableModelRequestLogging:
            getEnvSetting(
                env,
                EnvVars.ENABLE_MODEL_REQUEST_LOGGING,
                endpointName,
                "false",
            ) === "true",
    };
}
