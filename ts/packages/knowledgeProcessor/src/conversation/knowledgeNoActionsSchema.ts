// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Quantity = {
    amount: number;
    units: string;
};

export type Value = string | number | boolean | Quantity;

export type Facet = {
    name: string;
    // Very concise values.
    value: Value;
};

// Specific, tangible people, places, institutions or things only
export type ConcreteEntity = {
    // the name of the entity or thing such as "Bach", "Great Gatsby", "frog" or "piano"
    name: string;
    // the types of the entity such as "speaker", "person", "artist", "animal", "object", "instrument", "school", "room", "museum", "food" etc.
    // An entity can have multiple types; entity types should be single words
    type: string[];
    // A specific, inherent, defining, or non-immediate facet of the entity such as "blue", "old", "famous", "sister", "aunt_of", "weight: 4 kg"
    // trivial actions or state changes are not facets
    // facets are concise "properties"
    facets?: Facet[];
};

// Detailed and comprehensive knowledge response
export type KnowledgeResponse = {
    entities: ConcreteEntity[];
    // Detailed, descriptive topics and keyword.
    topics: string[];
};
