// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as azSearch from "@azure/search-documents";
import { createSearchField, createVectorField } from "./azSearchCommon.js";
import {
    AzVectorIndex,
    AzVectorSearchSettings,
    createVectorQuery,
    SimilarityAlgorithm,
} from "./azSearchIndex.js";
import { NormalizedEmbedding } from "typeagent";

export interface TermDoc {
    termId: string;
    term: string;
    embedding?: number[];
}

export class AzTermsVectorIndex extends AzVectorIndex<TermDoc> {
    constructor(settings: AzVectorSearchSettings) {
        super(
            settings,
            createTermIndexSchema(
                settings.indexName,
                settings.dimensions,
                settings.similarity,
            ),
        );
    }

    public async getNearest(
        embedding: NormalizedEmbedding,
        maxMatches?: number,
        minScore?: number,
    ): Promise<string[]> {
        const vectorQuery = createVectorQuery<TermDoc>(embedding, maxMatches);
        const searchResults = await this.searchVector(vectorQuery, ["term"]);
        let results: string[] = [];
        for await (const result of searchResults.results) {
            results.push(result.document.term);
        }
        return results;
    }

    public async addTerms(
        terms: TermDoc[],
    ): Promise<azSearch.IndexingResult[]> {
        if (terms.length === 0) {
            return [];
        }
        const result = await this.searchClient.uploadDocuments(terms);
        return result.results;
    }
}

export function createTermIndexSchema(
    indexName: string,
    vectorDimensions: number,
    similarity: SimilarityAlgorithm,
): azSearch.SearchIndex {
    const termId = createSearchField(
        "termId",
        "Edm.String",
        false, // No word breaking
    ) as azSearch.SimpleField;
    termId.key = true; // Must be unique

    const searchProfile = "nn";
    const vectorIndex: azSearch.SearchIndex = {
        name: indexName,
        fields: [
            termId,
            createSearchField("term", "Edm.String", true),
            createVectorField("embedding", vectorDimensions, searchProfile),
        ],
    };
    // https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-create-index?tabs=config-2024-07-01%2Crest-2024-07-01%2Cpush%2Cportal-check-index#add-a-vector-search-configuration
    vectorIndex.vectorSearch = {
        algorithms: [
            {
                name: searchProfile,
                kind: "exhaustiveKnn",
                // Use a dot product because our vectors are normalized
                parameters: { metric: similarity },
            },
            /*
            {
                name: "hnsw",
                kind: "hnsw",
                parameters: {
                    m: 4,
                    efConstruction: 400,
                    efSearch: 500,
                    metric: similarity,
                },
            },
            */
        ],
        profiles: [
            {
                name: "nn",
                algorithmConfigurationName: "nn", // Must be one of algorithms above
            },
        ],
    };
    return vectorIndex;
}
