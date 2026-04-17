// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type EntityFacetValue =
    | string
    | number
    | boolean
    | { [key: string]: EntityFacetValue }
    | EntityFacetValue[];

export interface EntityFacet {
    name: string;
    value: EntityFacetValue;
}

export interface Entity {
    // the name of the entity such as "Bach" or "frog"
    name: string;
    // the types of the entity such as "artist" or "animal"; an entity can have multiple types; entity types should be single words
    type: string[];

    // Stable unique id for this entity, will be round tripped back to the source agent if user refer to the entity in the future.
    uniqueId?: string | undefined;

    // Optional structured properties about this entity surfaced to the LLM as context.
    facets?: EntityFacet[] | undefined;
}
