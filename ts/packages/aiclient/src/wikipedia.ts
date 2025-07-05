// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getEnvSetting } from "./common.js";

export type WikipediaApiSettings = {
    endpoint?: string;
    accessToken?: string;
    clientId?: string;
    clientSecret?: string;
    getToken(): string;
};

/**
 * The environment variables used by the Wikipedia API.
 */
export enum EnvVars {
    WIKIPEDIA_ACCESS_TOKEN = "WIKIPEDIA_ACCESS_TOKEN",
    WIKIPEDIA_ENDPOINT = "WIKIPEDIA_ENDPOINT",
    WIKIPEDIA_CLIENT_SECRET = "WIKIPEDIA_CLIENT_SECRET",
    WIKIPEDIA_CLIENT_ID = "WIKIPEDIA_CLIENT_ID"
}

/**
 * Gets the API settings for the Wikipedia API from environment variables.
 * @param env The environment variables to use. If not provided, defaults to `process.env`.
 * @returns The specific Wikipedia API settings.
 */
export function apiSettingsFromEnv(
    env?: Record<string, string | undefined>,
): WikipediaApiSettings {
    env ??= process.env;
    return {
        endpoint: getEnvSetting(env, EnvVars.WIKIPEDIA_ENDPOINT),
        // TODO: refresh token: https://api.wikimedia.org/wiki/Authentication
        accessToken: getEnvSetting(env, EnvVars.WIKIPEDIA_ACCESS_TOKEN),
        clientId: getEnvSetting(env, EnvVars.WIKIPEDIA_ACCESS_TOKEN),
        clientSecret: getEnvSetting(env, EnvVars.WIKIPEDIA_ACCESS_TOKEN),
        getToken: (): string => {
        }
    };
}

export async function getToken(config: WikipediaApiSettings): Promise<string | undefined> {
    const response = await fetch("https://meta.wikimedia.org/w/rest.php/oauth2/access_token", {
        method: "POST",
        body: JSON.stringify({
            grant_type: "client_credentials",
            client_id: config.clientId,
            client_secret: config.clientSecret
        })
    });

    return await response.text();
}
