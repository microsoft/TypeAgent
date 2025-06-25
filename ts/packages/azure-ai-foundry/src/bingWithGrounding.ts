// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getEnvSetting } from "aiclient";

export type ApiSettings = {
    endpoint?: string;
    agent?: string;
    urlResolutionAgentId?: string;
    connectionId?: string;
    validatorAgentId?: string;
    httpEndpointLogicAppConnectionId?: string;
};

/**
 * The environment variables used by the Bing with Grounding API.
 */
export enum EnvVars {
    BING_WITH_GROUNDING_ENDPOINT = "BING_WITH_GROUNDING_ENDPOINT",
    BING_WITH_GROUNDING_AGENT_ID = "BING_WITH_GROUNDING_AGENT_ID",
    BING_WITH_GROUNDING_URL_RESOLUTION_AGENT_ID = "BING_WITH_GROUNDING_URL_RESOLUTION_AGENT_ID",
    BING_WITH_GROUNDING_URL_RESOLUTION_CONNECTION_ID = "BING_WITH_GROUNDING_URL_RESOLUTION_CONNECTION_ID",
    AZURE_FOUNDRY_AGENT_ID_VALIDATOR = "AZURE_FOUNDRY_AGENT_ID_VALIDATOR",
    LOGIC_APP_CONNECTION_ID_GET_HTTP_ENDPOINT = "LOGIC_APP_CONNECTION_ID_GET_HTTP_ENDPOINT",
}

/**
 * Gets the API settings for the Bing with Grounding API from environment variables.
 * @param env The environment variables to use. If not provided, defaults to `process.env`.
 * @returns The specific BING with Grounding API settings.
 */
export function apiSettingsFromEnv(
    env?: Record<string, string | undefined>,
): ApiSettings {
    env ??= process.env;
    return {
        endpoint: getEnvSetting(env, EnvVars.BING_WITH_GROUNDING_ENDPOINT),
        agent: getEnvSetting(env, EnvVars.BING_WITH_GROUNDING_AGENT_ID),
        urlResolutionAgentId: getEnvSetting(
            env,
            EnvVars.BING_WITH_GROUNDING_URL_RESOLUTION_AGENT_ID,
        ),
        connectionId: getEnvSetting(
            env,
            EnvVars.BING_WITH_GROUNDING_URL_RESOLUTION_CONNECTION_ID,
        ),
        validatorAgentId: getEnvSetting(
            env,
            EnvVars.AZURE_FOUNDRY_AGENT_ID_VALIDATOR,
        ),
        httpEndpointLogicAppConnectionId: getEnvSetting(
            env,
            EnvVars.LOGIC_APP_CONNECTION_ID_GET_HTTP_ENDPOINT,
        ),
    };
}
