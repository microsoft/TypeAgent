// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as azSearch from "@azure/search-documents";

export function createKnowledgeSchema(indexName: string): azSearch.SearchIndex {
    return {
        name: indexName,
        fields: [
            ...standardFields(),
            ...topicFields(),
            ...entityFields(),
            ...actionFields(),
        ],
    };
}

function standardFields(): azSearch.SearchField[] {
    return [
        {
            name: "semanticRefId",
            type: "Edm.String",
            key: true,
            searchable: false,
            filterable: false,
        },
        {
            name: "messageId",
            type: "Edm.Int32",
            searchable: false,
            filterable: false,
        },
        createKField("kType", "Edm.String"),
    ];
}

function entityFields(): azSearch.SearchField[] {
    return [
        createKField("name", "Edm.String"),
        createKField("type", "Collection(Edm.String)"),
        {
            name: "facets",
            type: "Collection(Edm.ComplexType)",
            fields: [
                createKField("facetName", "Edm.String"),
                createKField("facetValue", "Edm.String"),
            ],
        },
    ];
}

function actionFields(): azSearch.SearchField[] {
    return [
        createKField("verb", "Collection(Edm.String)"),
        createKField("subject", "Edm.String"),
        createKField("object", "Edm.String"),
        createKField("indirectObject", "Edm.String"),
    ];
}

function topicFields(): azSearch.SearchField[] {
    return [createKField("topic", "Edm.String", true)];
}

function createKField(
    name: string,
    type: azSearch.SearchFieldDataType,
    wordBreak: boolean = false,
): azSearch.SearchField {
    const field: azSearch.SearchField = {
        name,
        type,
        searchable: true,
        filterable: true,
    };
    if (!wordBreak) {
        field.analyzerName = "keyword";
    }
    return field;
}
