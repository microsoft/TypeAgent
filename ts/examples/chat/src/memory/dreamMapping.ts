// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Curated mapping of Wikidata properties onto knowPro entity augmentations.
 *
 * The table is intentionally small and explicit so that augmentation stays
 * predictable and easy to extend. Each Wikidata claim is dispatched by the
 * `kind` of its mapping, regardless of whether the underlying claim value is a
 * literal or an entity reference:
 *  - `type`    -> the value label is added to {@link ConcreteEntity.type}
 *  - `facet`   -> the value becomes a facet (name/value pair)
 *  - `related` -> the value becomes a facet AND (when entity-valued) is offered
 *                 as a related entity that can be cross-linked to other
 *                 entities in the conversation.
 */

import { conversation as kpLib } from "knowledge-processor";
import { WikidataClaims } from "./wikidataClient.js";

export type WikidataPropertyKind = "type" | "facet" | "related";

export type WikidataPropertyMapping = {
    /** Wikidata property id, e.g. "P31". */
    propertyId: string;
    /** Human friendly label (used in previews). */
    label: string;
    kind: WikidataPropertyKind;
    /** Facet name to use for `facet` / `related` mappings. */
    facetName?: string;
    /**
     * Hint that the attribute is naturally single-valued (e.g. date of birth).
     * Used by the deprecation post-pass to decide whether a changed value
     * supersedes a prior one.
     */
    singleValued?: boolean;
};

export const wikidataPropertyMappings: WikidataPropertyMapping[] = [
    // Types
    { propertyId: "P31", label: "instance of", kind: "type" },
    { propertyId: "P106", label: "occupation", kind: "type" },
    // Single-valued facets
    {
        propertyId: "P39",
        label: "position held",
        kind: "facet",
        facetName: "position",
        singleValued: true,
    },
    {
        propertyId: "P569",
        label: "date of birth",
        kind: "facet",
        facetName: "dateOfBirth",
        singleValued: true,
    },
    {
        propertyId: "P570",
        label: "date of death",
        kind: "facet",
        facetName: "dateOfDeath",
        singleValued: true,
    },
    {
        propertyId: "P856",
        label: "official website",
        kind: "facet",
        facetName: "website",
        singleValued: true,
    },
    {
        propertyId: "P159",
        label: "headquarters location",
        kind: "facet",
        facetName: "headquarters",
        singleValued: true,
    },
    // Multi-valued facets
    {
        propertyId: "P27",
        label: "country of citizenship",
        kind: "facet",
        facetName: "citizenship",
    },
    {
        propertyId: "P452",
        label: "industry",
        kind: "facet",
        facetName: "industry",
    },
    // Related entities (entity-valued)
    {
        propertyId: "P108",
        label: "employer",
        kind: "related",
        facetName: "employer",
    },
    {
        propertyId: "P112",
        label: "founded by",
        kind: "related",
        facetName: "foundedBy",
    },
    {
        propertyId: "P800",
        label: "notable work",
        kind: "related",
        facetName: "notableWork",
    },
];

let mappingIndex: Map<string, WikidataPropertyMapping> | undefined;

function getMappingIndex(): Map<string, WikidataPropertyMapping> {
    if (mappingIndex === undefined) {
        mappingIndex = new Map(
            wikidataPropertyMappings.map((m) => [m.propertyId, m]),
        );
    }
    return mappingIndex;
}

/** The set of property ids the claims query should fetch. */
export function curatedPropertyIds(): string[] {
    return wikidataPropertyMappings.map((m) => m.propertyId);
}

export type ProposedRelatedEntity = {
    propertyLabel: string;
    facetName: string;
    qid: string;
    label: string;
};

export type ProposedAugmentation = {
    newTypes: string[];
    newFacets: kpLib.Facet[];
    related: ProposedRelatedEntity[];
};

export type ExistingEntityKnowledge = {
    /** Lowercased existing types. */
    types: Set<string>;
    /** Lowercased "name=value" facet keys. */
    facetKeys: Set<string>;
};

function facetKey(name: string, value: string): string {
    return `${name.toLowerCase()}=${value.toLowerCase()}`;
}

/**
 * Map a set of Wikidata claims onto a proposed augmentation, skipping any
 * type/facet that the entity already has.
 */
export function mapClaimsToAugmentation(
    claims: WikidataClaims,
    existing: ExistingEntityKnowledge,
): ProposedAugmentation {
    const index = getMappingIndex();
    const newTypes: string[] = [];
    const newFacets: kpLib.Facet[] = [];
    const related: ProposedRelatedEntity[] = [];
    const addedTypes = new Set<string>();
    const addedFacetKeys = new Set<string>();

    const addType = (rawValue: string) => {
        const value = rawValue.trim();
        if (value.length === 0) {
            return;
        }
        const key = value.toLowerCase();
        if (existing.types.has(key) || addedTypes.has(key)) {
            return;
        }
        addedTypes.add(key);
        newTypes.push(value);
    };

    const addFacet = (name: string, rawValue: string) => {
        const value = rawValue.trim();
        if (value.length === 0) {
            return;
        }
        const key = facetKey(name, value);
        if (existing.facetKeys.has(key) || addedFacetKeys.has(key)) {
            return;
        }
        addedFacetKeys.add(key);
        newFacets.push({ name, value });
    };

    // Unify literal and entity-valued claims into (propertyId, label, qid?).
    const unified: {
        propertyId: string;
        displayValue: string;
        qid?: string;
    }[] = [];
    for (const literal of claims.literals) {
        unified.push({
            propertyId: literal.propertyId,
            displayValue: literal.value,
        });
    }
    for (const rel of claims.related) {
        unified.push({
            propertyId: rel.propertyId,
            displayValue: rel.label,
            qid: rel.qid,
        });
    }

    for (const claim of unified) {
        const mapping = index.get(claim.propertyId);
        if (mapping === undefined) {
            continue;
        }
        switch (mapping.kind) {
            case "type":
                addType(claim.displayValue);
                break;
            case "facet":
                addFacet(
                    mapping.facetName ?? mapping.label,
                    claim.displayValue,
                );
                break;
            case "related": {
                const facetName = mapping.facetName ?? mapping.label;
                addFacet(facetName, claim.displayValue);
                if (claim.qid !== undefined) {
                    related.push({
                        propertyLabel: mapping.label,
                        facetName,
                        qid: claim.qid,
                        label: claim.displayValue,
                    });
                }
                break;
            }
        }
    }

    return { newTypes, newFacets, related };
}
