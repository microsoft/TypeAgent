// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as azSearch from "@azure/search-documents";

export function createKnowledgeSchema(indexName: string): azSearch.SearchIndex {
    return {
        name: indexName,
        fields: [
            {
                name: "semanticRefId",
                type: "Edm.String",
                key: true,
                searchable: false,
            },
            { name: "messageId", type: "Edm.String", searchable: false }, // Reference to the original message
            { name: "type", type: "Edm.String", searchable: true }, // Either "entity" or "action"
            { name: "topic", type: "Edm.String", searchable: true }, // For correlated searches by topic
            // Entity fields
            { name: "entityName", type: "Edm.String", searchable: true },
            {
                name: "entityType",
                type: "Collection(Edm.String)",
                searchable: true,
            },
            {
                name: "entityFacets",
                type: "Collection(Edm.ComplexType)",
                fields: [
                    { name: "facetName", type: "Edm.String", searchable: true },
                    {
                        name: "facetValue",
                        type: "Edm.String",
                        searchable: true,
                    }, // String facet value
                    {
                        name: "facetValueN",
                        type: "Edm.Double",
                        searchable: false,
                    }, // Numeric facet value
                ],
            },
            // Action fields
            {
                name: "verb",
                type: "Collection(Edm.String)",
                searchable: true,
            },
            {
                name: "subject",
                type: "Edm.String",
                searchable: true,
            },
            {
                name: "object",
                type: "Edm.String",
                searchable: true,
            },
            {
                name: "indirectObject",
                type: "Edm.String",
                searchable: true,
            },
            {
                name: "actionParams",
                type: "Collection(Edm.ComplexType)",
                fields: [
                    { name: "paramName", type: "Edm.String", searchable: true },
                    {
                        name: "paramValue",
                        type: "Edm.String",
                        searchable: true,
                    }, // String parameter value
                    {
                        name: "paramValueN",
                        type: "Edm.Double",
                        searchable: false,
                    }, // Numeric parameter value
                ],
            },
            {
                name: "actionSubjectEntityFacetName",
                type: "Edm.String",
                searchable: true,
            },
            {
                name: "actionSubjectEntityFacetValue",
                type: "Edm.String",
                searchable: true,
            }, // String facet value
            {
                name: "actionSubjectEntityFacetValueN",
                type: "Edm.Double",
                searchable: false,
            }, // Numeric facet value
        ],
        // Optionally define scoring profiles, suggesters, etc.
    };
}
