// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as azSearch from "@azure/search-documents";
import * as kp from "knowpro";
import { conversation as kpLib } from "knowledge-processor";
import { AzSearchIndex } from "./azSearchIndex.js";
import { AzSearchSettings } from "./azSearchCommon.js";

export interface SemanticRefDocBase {
    semanticRefOrdinal: string;
    start: kp.TextLocation;
    end?: kp.TextLocation | undefined;
    kType: kp.KnowledgeType;
}

export interface EntityDoc extends SemanticRefDocBase {
    name: string;
    type: string[];
    facets?: EntityFacet[] | undefined;
}

export type EntityFacet = {
    name: string;
    value: string;
};

export interface TopicDoc extends SemanticRefDocBase {
    topic: string;
}

export interface ActionDoc extends SemanticRefDocBase {
    verbs: string[];
    subject?: string | undefined;
    object?: string | undefined;
    indirectObject?: string | undefined;
}

export type SemanticRefDoc = EntityDoc | TopicDoc | ActionDoc;

export class AzSemanticRefIndex extends AzSearchIndex<SemanticRefDoc> {
    constructor(settings: AzSearchSettings) {
        super(settings);
    }

    public async ensure(): Promise<boolean> {
        return this.ensureIndex(createKnowledgeSchema(this.settings.indexName));
    }

    public async addSemanticRef(sr: kp.SemanticRef): Promise<void> {
        let doc: SemanticRefDoc | undefined;
        switch (sr.knowledgeType) {
            default:
                break;
            case "entity":
                doc = entityToDoc(sr);
                break;
        }
        if (!doc) {
            return;
        }
        await this.searchClient.uploadDocuments([doc]);
    }
}

export function entityToDoc(sr: kp.SemanticRef): EntityDoc {
    checkType(sr, "entity");
    const entity = sr.knowledge as kpLib.ConcreteEntity;
    const entityDoc: EntityDoc = {
        kType: "entity",
        semanticRefOrdinal: sr.semanticRefOrdinal.toString(),
        start: sr.range.start,
        end: sr.range.end,
        name: entity.name,
        type: entity.type,
    };
    if (entity.facets && entity.facets.length > 0) {
        entityDoc.facets = entity.facets.map((f) => {
            return { name: f.name, value: facetValueToString(f) };
        });
    }
    return entityDoc;
}

function facetValueToString(facet: kpLib.Facet): string {
    const value = facet.value;
    if (typeof value === "object") {
        return `${value.amount} ${value.units}`;
    }
    return value.toString();
}

function checkType(sr: kp.SemanticRef, expectedType: kp.KnowledgeType) {
    if (sr.knowledgeType !== expectedType) {
        throw new Error(`sr.${sr.knowledgeType} !== ${expectedType}`);
    }
}

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
            name: "semanticRefOrdinal",
            type: "Edm.String",
            key: true,
            searchable: false,
            filterable: false,
        },
        {
            name: "start",
            type: "Edm.ComplexType",
            fields: locationFields(),
        },
        { name: "end", type: "Edm.ComplexType", fields: locationFields() },
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
                createKField("name", "Edm.String"),
                createKField("value", "Edm.String"),
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

function locationFields(): azSearch.SearchField[] {
    return [
        {
            name: "messageOrdinal",
            type: "Edm.Int32",
            searchable: false,
            filterable: true,
        },
        {
            name: "chunkOrdinal",
            type: "Edm.Int32",
            searchable: false,
            filterable: true,
        },
    ];
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
