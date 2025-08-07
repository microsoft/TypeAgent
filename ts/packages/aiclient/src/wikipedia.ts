// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getEnvSetting } from "./common.js";
import { wikipedia } from "./index.js";

export type WikipediaApiSettings = {
    endpoint?: string;
    accessToken?: string;
    clientId?: string;
    clientSecret?: string;
    getToken(): Promise<string>;
    getAPIHeaders(): Promise<any>;
};

/**
 * The environment variables used by the Wikipedia API.
 */
export enum EnvVars {
    WIKIPEDIA_ENDPOINT = "WIKIPEDIA_ENDPOINT",
    WIKIPEDIA_CLIENT_SECRET = "WIKIPEDIA_CLIENT_SECRET",
    WIKIPEDIA_CLIENT_ID = "WIKIPEDIA_CLIENT_ID",
}

let wikiToken: string | undefined;
let wikiTokenExpiry: number | undefined;

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
        clientId: getEnvSetting(env, EnvVars.WIKIPEDIA_CLIENT_ID),
        clientSecret: getEnvSetting(env, EnvVars.WIKIPEDIA_CLIENT_SECRET),
        getToken: async (): Promise<string> => {
            // If the token hasn't expired, just return it
            if (wikiToken && wikiTokenExpiry && Date.now() < wikiTokenExpiry) {
                return wikiToken;
            }

            const params = new URLSearchParams();
            params.append("grant_type", "client_credentials");
            params.append(
                "client_id",
                getEnvSetting(env, EnvVars.WIKIPEDIA_CLIENT_ID),
            );
            params.append(
                "client_secret",
                getEnvSetting(env, EnvVars.WIKIPEDIA_CLIENT_SECRET),
            );

            const response = await fetch(
                "https://meta.wikimedia.org/w/rest.php/oauth2/access_token",
                {
                    method: "POST",
                    body: params,
                },
            );

            if (!response.ok) {
                throw new Error(
                    `Failed to get token: ${response.status} ${response.statusText}`,
                );
            }

            const data = await response.json();
            wikiToken = (data as any).access_token;
            wikiTokenExpiry = Date.now() + (data as any).expires_in * 1000; // expires_in is in seconds

            return wikiToken!;
        },
        getAPIHeaders: async (): Promise<any> => {

            // get the token first
            if (!wikiToken) {
                await apiSettingsFromEnv(env).getToken();
            }

            return {
                Authorization: `Bearer ${wikiToken}`,
                "Api-User-Agent": `TypeAgent/https://github.com/microsoft/TypeAgent`,
            };
        },
    };
}

export function getPageObject(title: string, config: wikipedia.WikipediaApiSettings) {
    // TODO: implement
}
