// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as azSearch from "@azure/search-documents";
import * as kp from "knowpro";
import { conversation as kpLib } from "knowledge-processor";
import { AzSearchIndex } from "./azSearchIndex.js";
import { AzSearchSettings, createSearchField } from "./azSearchCommon.js";
import { AzSearchCompilerSettings, AzSearchQueryCompiler } from "./azQuery.js";

export interface SemanticRefHeader {
    semanticRefOrdinal: string;
    start: kp.TextLocation;
    end?: kp.TextLocation | undefined;
    kType: kp.KnowledgeType;
    timestamp?: string | undefined;
}

export interface EntityDoc {
    name: string;
    type: string[];
    facets?: EntityFacet[] | undefined;
}

export type EntityFacet = {
    name: string;
    value: string;
};

export type TopicDoc = {
    topic?: string | undefined;
};

export type ActionDoc = {
    verbs?: string[];
    subject?: string | undefined;
    object?: string | undefined;
    indirectObject?: string | undefined;
};

export type KnowledgeDoc = EntityDoc | TopicDoc | ActionDoc;
export type SemanticRefDoc = SemanticRefHeader & KnowledgeDoc;

export type AzSemanticRefQuery = {
    searchQuery: string;
    filter?: string | undefined;
};

export class AzSemanticRefIndex extends AzSearchIndex<SemanticRefDoc> {
    public queryCompiler: AzSearchQueryCompiler;

    constructor(settings: AzSearchSettings) {
        super(settings, createKnowledgeSchema(settings.indexName));
        this.queryCompiler = new AzSearchQueryCompiler(createCompilerOptions());
    }

    public async search(
        query: string | kp.SearchTermGroup,
        when?: kp.WhenFilter,
    ): Promise<
        [
            query: AzSemanticRefQuery,
            matches: azSearch.SearchResult<SemanticRefDoc>[],
        ]
    > {
        let searchQuery =
            typeof query === "string"
                ? query
                : this.queryCompiler.compileSearchTermGroup(query);
        let filter = when ? this.queryCompiler.compileWhen(when) : undefined;
        //orderby: "search.score() desc"
        const searchOptions: azSearch.SearchOptions<SemanticRefDoc> = {
            queryType: "full",
        };
        if (filter) {
            searchOptions.filter = filter;
        }
        let results = await this.getSearchResults(searchQuery, searchOptions);
        return [{ searchQuery, filter }, results];
    }

    public async addSemanticRefs(
        sRefs: kp.SemanticRef | kp.SemanticRef[],
        timestamp?: string,
    ): Promise<azSearch.IndexingResult[]> {
        let docs: SemanticRefDoc[];
        if (Array.isArray(sRefs)) {
            docs = sRefs.map((sr) => semanticRefToDoc(sr, timestamp));
        } else {
            docs = [semanticRefToDoc(sRefs, timestamp)];
        }
        if (docs.length > 0) {
            const result = await this.searchClient.uploadDocuments(docs);
            return result.results;
        }
        return [];
    }
}

export function semanticRefToDoc(
    sr: kp.SemanticRef,
    timestamp?: string,
): SemanticRefDoc {
    const header = semanticRefToHeader(sr, timestamp);
    let doc: KnowledgeDoc | undefined;
    switch (sr.knowledgeType) {
        default:
            throw new Error("Not supported");
        case "entity":
            doc = entityToDoc(sr.knowledge as kpLib.ConcreteEntity);
            break;
        case "topic":
            doc = topicToDoc(sr.knowledge as kp.Topic);
            break;
        case "action":
            doc = actionToDoc(sr.knowledge as kpLib.Action);
            break;
        case "sTag":
            doc = entityToDoc(sr.knowledge as kp.StructuredTag);
            break;
    }
    return {
        ...header,
        ...doc,
    };
}

export function semanticRefToHeader(
    sr: kp.SemanticRef,
    timestamp?: string,
): SemanticRefHeader {
    const range = kp.normalizeTextRange(sr.range);
    let header: SemanticRefHeader = {
        kType: sr.knowledgeType,
        semanticRefOrdinal: semanticRefOrdinalToKey(sr.semanticRefOrdinal),
        start: range.start,
        end: range.end,
    };
    if (timestamp) {
        header.timestamp = timestamp;
    }
    return header;
}

function semanticRefOrdinalToKey(ordinal: kp.SemanticRefOrdinal): string {
    return ordinal.toString();
}

/*
function keyToSemanticRefOrdinal(key: string): kp.SemanticRefOrdinal {
    return Number.parseInt(key);
}
*/

export function entityToDoc(entity: kpLib.ConcreteEntity): EntityDoc {
    const entityDoc: EntityDoc = {
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

export function topicToDoc(sr: kp.Topic): TopicDoc {
    return {
        topic: sr.text,
    };
}

export function actionToDoc(sr: kpLib.Action): ActionDoc {
    return {
        verbs: sr.verbs,
        subject: sr.subjectEntityName,
        object: sr.objectEntityName,
    };
}

function facetValueToString(facet: kpLib.Facet): string {
    const value = facet.value;
    if (typeof value === "object") {
        return `${value.amount} ${value.units}`;
    }
    return value.toString();
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
        createSearchField("kType", "Edm.String"),
        createSearchField("timestamp", "Edm.String"),
    ];
}

function entityFields(): azSearch.SearchField[] {
    return [
        createSearchField("name", "Edm.String"),
        createSearchField("type", "Collection(Edm.String)"),
        {
            name: "facets",
            type: "Collection(Edm.ComplexType)",
            fields: [
                createSearchField("name", "Edm.String"),
                createSearchField("value", "Edm.String"),
            ],
        },
    ];
}

function actionFields(): azSearch.SearchField[] {
    return [
        createSearchField("verbs", "Collection(Edm.String)"),
        createSearchField("subject", "Edm.String"),
        createSearchField("object", "Edm.String"),
        createSearchField("indirectObject", "Edm.String"),
    ];
}

function topicFields(): azSearch.SearchField[] {
    return [createSearchField("topic", "Edm.String", true)];
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

function createCompilerOptions(): AzSearchCompilerSettings {
    return {
        // True for knowPro compat
        phraseMatch: true,
        propertyFields: createPropertyNameToFieldPathMap(),
        timestampField: "timestamp",
        kTypeField: "kType",
        rangeStartField: "start/messageOrdinal",
        rangeEndField: "end/messageOrdinal",
    };
}

/**
 * Return a mapping from knowPro {@link kp.PropertyNames} to fields in the Azure Search index
 * @returns
 */
function createPropertyNameToFieldPathMap(): Map<kp.PropertyNames, string> {
    const fieldPaths = new Map<kp.PropertyNames, string>();
    fieldPaths.set(kp.PropertyNames.EntityName, "name");
    fieldPaths.set(kp.PropertyNames.EntityType, "type");
    fieldPaths.set(kp.PropertyNames.FacetName, "facets/name");
    fieldPaths.set(kp.PropertyNames.FacetValue, "facets/value");
    fieldPaths.set(kp.PropertyNames.Topic, "topic");
    fieldPaths.set(kp.PropertyNames.Verb, "verb");
    fieldPaths.set(kp.PropertyNames.Subject, "subject");
    fieldPaths.set(kp.PropertyNames.Object, "object");
    fieldPaths.set(kp.PropertyNames.IndirectObject, "indirectObject");
    return fieldPaths;
}
