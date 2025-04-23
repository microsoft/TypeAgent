// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Result, success, error } from "typechat";
import { getJson } from "./restClient.js";
import { getEnvSetting } from "./common.js";

export type ApiSettings = {
    apiKey: string;
    maxRetryAttempts?: number;
    retryPauseMs?: number;
};

export enum EnvVars {
    BING_API_KEY = "BING_API_KEY",
}

export function apiSettingsFromEnv(
    env?: Record<string, string | undefined>,
): ApiSettings {
    env ??= process.env;
    return {
        apiKey: getEnvSetting(env, EnvVars.BING_API_KEY),
    };
}

/**
 * Search options to pass on the qs
 * Do not rename these: these are treated as name value pairs and
 * serialized to query strings as is
 */
export interface SearchOptions {
    count?: number;
    offset?: number;
    cc?: string; // country code
    mkt?: string; // Market
    size?: "Small" | "Medium" | "Large" | "Wallpaper" | "All";
}

// https://learn.microsoft.com/en-us/bing/search-apis/bing-entity-search/reference/response-objects#entity
export type Entity = {
    name: string;
    description?: string;
};

// https://learn.microsoft.com/en-us/bing/search-apis/bing-entity-search/reference/response-objects#entityanswer
export type EntityAnswer = {
    value: Entity[];
};

// https://learn.microsoft.com/en-us/bing/search-apis/bing-news-search/reference/response-objects#newsarticle
export type NewsArticle = {
    clusteredArticles?: NewsArticle[];
    // YYYY-MM-DDTHH:MM:SS
    datePublished: string;
    description: string;
    headline: string;
    url: string;
};

// https://learn.microsoft.com/en-us/bing/search-apis/bing-news-search/reference/response-objects#newsanswer
export type NewsAnswer = {
    value: NewsArticle[];
};

// You can get additional properties from here:
// https://learn.microsoft.com/en-us/bing/search-apis/bing-web-search/reference/response-objects#webanswer
export type WebPage = {
    name: string;
    url: string;
    snippet: string;
};

export type Image = {
    contentUrl: string;
    thumbnailUrl: string;
};

export type WebAnswer = {
    value: WebPage[];
};

export type SearchResponse = {
    entities?: EntityAnswer;
    news?: NewsAnswer;
    webPages?: WebAnswer;
};

type ImageSearchResponse = {
    value: Image[];
};

export interface SearchAPI {
    webSearch(
        query: string | string[],
        options?: SearchOptions,
    ): Promise<Result<WebPage[]>>;
    imageSearch(
        query: string,
        options?: SearchOptions,
    ): Promise<Result<Image[]>>;
    search(
        query: string,
        options?: SearchOptions,
        responseFilter?: string,
    ): Promise<Result<SearchResponse>>;
}

/**
 * Create a Bing Search client. Requires a Bing API key.
 * If no API key provided in settings, tries to load BING_API_KEY from environment.
 * If no API key available, returns an error.
 * @param settings Api Settings. If not supplied, initialized from Environment
 * @returns Bing client if success, else error.
 */
export async function createBingSearch(
    settings?: ApiSettings,
): Promise<Result<SearchAPI>> {
    try {
        settings ??= apiSettingsFromEnv();
    } catch (e) {
        return error(`Could not create Bing Client:\n${e}`);
    }

    const baseUrl = "https://api.bing.microsoft.com/v7.0";
    const webEndpoint = baseUrl + "/search";
    const imageEndpoint = baseUrl + "/images/search";
    const headers = createApiHeaders(settings);

    return success({
        webSearch,
        imageSearch,
        search,
    });

    /**
     *
     * @param query If multiple strings supplied, turns them into an 'OR' by default
     * @param options
     * @returns
     */
    async function webSearch(
        query: string | string[],
        options?: SearchOptions,
    ): Promise<Result<WebPage[]>> {
        const queryText =
            typeof query === "string" ? query : buildQuery(query, "OR");

        const response = await search(queryText, options, "WebPages");
        if (response.success) {
            const webPages = response.data.webPages?.value ?? [];
            return success(webPages);
        }
        return response;
    }

    async function imageSearch(
        query: string,
        options?: SearchOptions,
    ): Promise<Result<Image[]>> {
        let queryString = "?q=" + encodeURIComponent(query);
        if (options) {
            queryString = optionsToQS(queryString, options);
        }
        const response = await getJson(
            headers,
            imageEndpoint + queryString,
            settings!.maxRetryAttempts,
            settings!.retryPauseMs,
        );
        if (response.success) {
            const searchResponse = response.data as ImageSearchResponse;
            return success(searchResponse.value);
        }
        return response;
    }

    // Types of response filter:
    // https://learn.microsoft.com/en-us/bing/search-apis/bing-web-search/reference/response-objects
    async function search(
        query: string,
        options?: SearchOptions,
        responseFilter?: string,
    ): Promise<Result<SearchResponse>> {
        let queryString = "?q=" + encodeURIComponent(query);
        if (responseFilter) {
            responseFilter =
                "&responseFilter=" + encodeURIComponent(responseFilter);
        }
        if (options) {
            queryString = optionsToQS(queryString, options);
        }
        const response = await getJson(
            headers,
            webEndpoint + queryString,
            settings!.maxRetryAttempts,
            settings!.retryPauseMs,
        );
        if (response.success) {
            return success(<SearchResponse>response.data);
        }
        return response;
    }

    function optionsToQS(query: string, options: any): string {
        for (const key in options) {
            query = appendNV(query, key, options[key]);
        }
        return query;
    }
}

/**
 * Bing Web Search.
 * REQUIRED: Environment variable: BING_API_KEY
 * @param query query to run
 * @param count number of matches
 * @param site (optional) Site specific search
 * @returns
 */
export async function searchWeb(
    query: string,
    count?: number,
    site?: string,
): Promise<WebPage[]> {
    let options = count ? { count } : undefined;
    if (site) {
        query += ` site:${encodeURIComponent(site)}`;
    }
    // Automatically uses Environment variable: BING_API_KEY
    const clientResult = await createBingSearch();
    if (!clientResult.success) {
        return [];
    }
    const client = clientResult.data;
    const results = await client.webSearch(query, options);
    return results.success ? results.data : [];
}

/**
 * Bing Image Search.
 * REQUIRED: Environment variable: BING_API_KEY
 * @param query query to run
 * @param count number of matches
 * @returns
 */
export async function searchImages(
    query: string,
    count?: number,
): Promise<Image[]> {
    const options = count ? { count } : undefined;
    // Automatically uses Environment variable: BING_API_KEY
    const clientResult = await createBingSearch();
    if (!clientResult.success) {
        return [];
    }
    const client = clientResult.data;
    const results = await client.imageSearch(query, options);
    return results.success ? results.data : [];
}

export function buildQuery(queries: string[], operator: "AND" | "OR"): string {
    if (queries.length === 1) {
        return queries[0];
    }
    let query = "";
    let operatorText = ` ${operator} `;
    for (let i = 0; i < queries.length; ++i) {
        if (i > 0) {
            query += operatorText;
        }
        query += `(${queries[i]})`;
    }
    return query;
}

function createApiHeaders(settings: ApiSettings): Record<string, string> {
    return {
        "Ocp-Apim-Subscription-Key": settings.apiKey,
    };
}

function appendNV(text: string, name: string, value?: any): string {
    if (text.length > 0) {
        text += "&";
    }
    if (value) {
        text += `${name}=${value}`;
    }
    return text;
}
