// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as azSearch from "@azure/search-documents";
import { createDefaultCredential, getEnvSetting } from "aiclient";

export enum EnvVars {
    AZURE_SEARCH_ENDPOINT = "AZURE_SEARCH_ENDPOINT",
}

export function getAzureSearchEndpoint(): string {
    return getEnvSetting(process.env, EnvVars.AZURE_SEARCH_ENDPOINT);
}

export interface AzSearchSettings {
    endpoint: string;
    indexName: string;
}

export function createAzSearchSettings(indexName: string): AzSearchSettings {
    return {
        endpoint: getAzureSearchEndpoint(),
        indexName,
    };
}

export function createAzureSearchClient<T extends object>(
    settings: AzSearchSettings,
): azSearch.SearchClient<T> {
    return new azSearch.SearchClient<T>(
        settings.endpoint,
        settings.indexName,
        createDefaultCredential(),
    );
}

export function createAzureSearchIndexClient<T extends object>(
    settings: AzSearchSettings,
): azSearch.SearchIndexClient {
    return new azSearch.SearchIndexClient(
        settings.endpoint,
        createDefaultCredential(),
    );
}
