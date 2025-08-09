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

/**
 * Get the page object of the item with the supplied title.
 * @param title - The title of the page to retrieve
 * @param config - The wikipedia API configuration
 * @returns The page object.
 */
export async function getPageObject(
    title: string,
    config: wikipedia.WikipediaApiSettings,
) {
    // TODO: localization (e.g. en, de, fr, etc.)
    const response = await fetch(
        `${config.endpoint}core/v1/wikipedia/en/page/${title}/bare`,
        { method: "GET", headers: await config.getAPIHeaders() },
    );

    if (response.ok) {
        return response.json();
    } else {
        return undefined;
    }
}

/**
 *
 * @param title - The title of the page whose content to get.
 * @param config - The wikipedia API configuration
 * @returns - The content of the requetsed page or undefined if there was a problem
 */
export async function getPageMarkdown(
    title: string,
    config: wikipedia.WikipediaApiSettings,
): Promise<string | undefined> {
    // TODO: localization (e.g. en, de, fr, etc.)
    const url: string = `${config.endpoint}en/page/${encodeWikipediaTitle(title)}`;
    const response = await fetch(url, {
        method: "GET",
        headers: await config.getAPIHeaders(),
    });

    if (response.ok) {
        return response.text();
    } else {
        return undefined;
    }
}

/**
 * Encodes a non-modified (human readable) Wikipedia title for use in a URL.
 * @param title - The title of the page to encode.
 * @returns - The encoded title suitable for use in a URL.
 */
export function encodeWikipediaTitle(title: string): string {
    return encodeURIComponent(title.replace(/ /g, "_"));
}
