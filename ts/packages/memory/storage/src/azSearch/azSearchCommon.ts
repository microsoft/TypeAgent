// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as azSearch from "@azure/search-documents";
import { createDefaultCredential, getEnvSetting } from "aiclient";
import { NormalizedEmbedding } from "typeagent";

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

export function createSearchField(
    name: string,
    type: azSearch.SearchFieldDataType,
    wordBreak: boolean = true,
): azSearch.SearchField {
    const field: azSearch.SearchField = {
        name,
        type,
        searchable: true,
        filterable: true,
    };
    if (wordBreak !== undefined && !wordBreak) {
        field.analyzerName = "keyword";
    }
    return field;
}

export function createVectorField(
    name: string,
    dimensions: number,
    profile: string,
): azSearch.SimpleField {
    return {
        name,
        type: "Collection(Edm.Single)",
        searchable: true,
        filterable: false,
        stored: true,
        vectorSearchDimensions: dimensions,
        vectorSearchProfileName: profile,
    };
}

export function embeddingToVector(embedding: NormalizedEmbedding): number[] {
    return Array.from<number>(embedding);
}

export function sortResultsAscending<T extends object>(
    results: azSearch.SearchResult<T>[],
) {
    return results.sort((x, y) => x.score - y.score);
}
