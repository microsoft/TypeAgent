// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as azSearch from "@azure/search-documents";
import {
    AzSearchSettings,
    createAzSearchSettings,
    createAzureSearchClient,
    createAzureSearchIndexClient,
    embeddingToVector,
} from "./azSearchCommon.js";
import { NormalizedEmbedding } from "typeagent";

export class AzSearchIndex<T extends object> {
    public searchClient: azSearch.SearchClient<T>;

    constructor(
        public settings: AzSearchSettings,
        public schema: azSearch.SearchIndex,
    ) {
        this.searchClient = createAzureSearchClient(settings);
    }

    public async ensureExists(): Promise<boolean> {
        const indexClient = createAzureSearchIndexClient(this.settings);
        const index = await indexClient.createOrUpdateIndex(this.schema);
        return index !== undefined;
    }

    protected async getSearchResults(
        searchQuery: string,
        searchOptions: azSearch.SearchOptions<T>,
    ): Promise<azSearch.SearchResult<T>[]> {
        const searchResults = await this.searchClient.search(
            searchQuery,
            searchOptions,
        );
        // Search returns a paging iterator. Collect all results
        let results: azSearch.SearchResult<T>[] = [];
        for await (const result of searchResults.results) {
            results.push(result);
        }
        return results;
    }
}

export class AzSearchIndexManager {
    public searchIndexClient: azSearch.SearchIndexClient;

    constructor(public settings: AzSearchSettings) {
        this.searchIndexClient = createAzureSearchIndexClient(this.settings);
    }

    public async ensureIndex(schema: azSearch.SearchIndex): Promise<boolean> {
        const indexClient = createAzureSearchIndexClient(this.settings);
        const index = await indexClient.createOrUpdateIndex(schema);
        return index !== undefined;
    }

    public async indexExists(): Promise<boolean> {
        try {
            const index = await this.searchIndexClient.getIndex(
                this.settings.indexName,
            );
            return index !== undefined;
        } catch (error: any) {
            // 404: NotFound
            if (error.statusCode !== undefined && error.statusCode === 404) {
                return false;
            } else {
                throw error;
            }
        }
    }
}

export type SimilarityAlgorithm = "dotProduct" | "cosine";

export interface AzVectorSearchSettings extends AzSearchSettings {
    dimensions: number;
    similarity: SimilarityAlgorithm;
}

export function createAzVectorSearchSettings(
    indexName: string,
    dimensions: number,
): AzVectorSearchSettings {
    return {
        ...createAzSearchSettings(indexName),
        dimensions,
        similarity: "dotProduct",
    };
}

export class AzVectorIndex<T extends object> extends AzSearchIndex<T> {
    constructor(
        settings: AzVectorSearchSettings,
        schema: azSearch.SearchIndex,
    ) {
        super(settings, schema);
    }

    public searchVector(
        queries: azSearch.VectorizedQuery<T> | azSearch.VectorizedQuery<T>[],
        selectFields: azSearch.SelectArray<azSearch.SelectFields<T>>,
    ): Promise<azSearch.SearchResult<T>[]> {
        const searchOptions: azSearch.SearchOptions<T> = {
            select: selectFields,
            vectorSearchOptions: {
                queries: Array.isArray(queries) ? queries : [queries],
            },
        };
        return this.getSearchResults("", searchOptions);
    }
}

export function createVectorQuery<T extends object>(
    fields: azSearch.SearchFieldArray<T>,
    embedding: NormalizedEmbedding,
    maxMatches?: number,
) {
    const vectorQuery: azSearch.VectorizedQuery<T> = {
        kind: "vector",
        vector: embeddingToVector(embedding),
        exhaustive: true,
        fields,
    };
    if (maxMatches !== undefined && maxMatches > 0) {
        vectorQuery.kNearestNeighborsCount = maxMatches;
    }
    return vectorQuery;
}
