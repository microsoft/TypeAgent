// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as azSearch from "@azure/search-documents";
import {
    AzSearchSettings,
    createAzureSearchClient,
    createAzureSearchIndexClient,
} from "./azSearchCommon.js";

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
