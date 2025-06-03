// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getEnvSetting } from "./common.js";

export type ApiSettings = {
    endpoint?: string;
    agent?: string;
};

/**
 * The environment variables used by the Bing with Grounding API.
 */
export enum EnvVars {
    BING_WITH_GROUNDING_ENDPOINT = "BING_WITH_GROUNDING_ENDPOINT",
    BING_WITH_GROUNDING_AGENT_ID = "BING_WITH_GROUNDING_AGENT_ID",
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
    };
}
