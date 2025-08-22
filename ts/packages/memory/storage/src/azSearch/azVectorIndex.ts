// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as azSearch from "@azure/search-documents";
import {
    AzSearchSettings,
    createAzSearchSettings,
    createSearchField,
    createVectorField,
} from "./azSearchCommon.js";
import { AzSearchIndex } from "./azSearchIndex.js";

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

export class AzVectorIndex extends AzSearchIndex<VectorDoc> {
    constructor(settings: AzVectorSearchSettings) {
        super(
            settings,
            createVectorSchema(
                settings.indexName,
                settings.dimensions,
                settings.similarity,
            ),
        );
    }
}

export interface VectorDoc {
    vectorText: string;
    vector?: number[];
}

export function createVectorSchema(
    indexName: string,
    vectorDimensions: number,
    similarity: SimilarityAlgorithm,
): azSearch.SearchIndex {
    const textField = createSearchField(
        "vectorText",
        "Edm.String",
        false, // No word breaking
    ) as azSearch.SimpleField;
    textField.key = true; // Must be unique

    const searchProfile = "nn";
    const vectorIndex: azSearch.SearchIndex = {
        name: indexName,
        fields: [
            textField,
            createVectorField("vector", vectorDimensions, searchProfile),
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
