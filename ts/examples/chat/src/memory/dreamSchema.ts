// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Schema for the @kpDream command's LLM passes. This file is loaded as schema
// text at runtime (via loadSchema) and must remain self-contained: only
// exported type definitions, no imports.

// A decision about whether a single extracted entity is worth looking up in
// Wikidata.
export type DreamGateDecision = {
    // The entity name, copied exactly from the input list.
    name: string;
    // True only when a real-world lookup would add useful facts. Use false for
    // generic concepts, common objects, pronouns, roles without a specific
    // referent, or vague/ambiguous mentions.
    shouldLookup: boolean;
    // Coarse category of the entity.
    category:
        | "person"
        | "organization"
        | "creativeWork"
        | "place"
        | "product"
        | "other";
    // The best query string to search Wikidata with. Usually the name itself,
    // optionally clarified using conversation context (e.g. add a surname).
    searchQuery: string;
    // Brief justification for the decision.
    reason: string;
};

export type DreamGateResponse = {
    decisions: DreamGateDecision[];
};

// Selection of the best matching Wikidata item from a candidate list, given
// what the conversation already knows about the entity.
export type DreamMatchResponse = {
    // The chosen Wikidata QID (for example "Q42"), or null when none of the
    // candidates is a confident match.
    qid: string | null;
    // Confidence in the chosen match, from 0 (guess) to 1 (certain).
    confidence: number;
    // Brief justification for the choice.
    reason: string;
};

// An existing facet that newly added Wikidata facts have superseded. The facet
// is never deleted; it is renamed to mark it as no longer current.
export type DreamDeprecation = {
    // The existing facet name being superseded.
    facetName: string;
    // The existing value that is no longer current.
    oldValue: string;
    // The new current value, when it is known.
    newValue?: string;
    // Brief justification for treating the old value as outdated.
    reason: string;
};

export type DreamDeprecationResponse = {
    // Only facets whose value has genuinely changed/been superseded. Additive
    // facts (multiple occupations, types, works, citizenships) must NOT appear
    // here.
    deprecations: DreamDeprecation[];
};
