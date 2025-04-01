// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    KnowledgePropertyName,
    PropertySearchTerm,
    SearchTerm,
    SearchTermGroup,
    SearchTermGroupTypes,
} from "./interfaces.js";

/**
 * Please inspect the following in interfaces.ts
 * @see {@link ./interfaces.ts}
 *
 * Term: {@link Term}
 * SearchTerm: {@link SearchTerm}
 * PropertySearchTerm: {@link PropertySearchTerm}
 * SearchTermGroup: {@link SearchTermGroup}
 * ITermToSemanticRefIndex: {@link ITermToSemanticRefIndex}
 * IPropertyToSemanticRefIndex: {@link IPropertyToSemanticRefIndex}
 */
export function createSearchTerm(text: string, score?: number): SearchTerm {
    return {
        term: {
            text,
            weight: score,
        },
    };
}

/**
 * Create a new property search term from the given name and value
 * @param name property name
 * @param value property value
 * @param exactMatchValue if true, configures propertyValue to only match exactly
 * @returns {PropertySearchTerm}
 */
export function createPropertySearchTerm(
    name: string,
    value: string,
    exactMatchValue: boolean = false,
): PropertySearchTerm {
    let propertyName: KnowledgePropertyName | SearchTerm;
    let propertyValue: SearchTerm;
    // Check if this is one of our well known predefined values
    switch (name) {
        default:
            propertyName = createSearchTerm(name);
            break;
        case "name":
        case "type":
        case "verb":
        case "subject":
        case "object":
        case "indirectObject":
        case "tag":
            propertyName = name;
            break;
    }
    propertyValue = createSearchTerm(value);
    if (exactMatchValue) {
        // No related terms should be matched for this term
        propertyValue.relatedTerms = [];
    }
    return { propertyName, propertyValue };
}

export function createAndTermGroup(
    ...terms: SearchTermGroupTypes[]
): SearchTermGroup {
    terms ??= [];
    return { booleanOp: "and", terms };
}

export function createOrTermGroup(
    ...terms: SearchTermGroupTypes[]
): SearchTermGroup {
    terms ??= [];
    return { booleanOp: "or", terms };
}

export function createOrMaxTermGroup(
    ...terms: SearchTermGroupTypes[]
): SearchTermGroup {
    terms ??= [];
    return { booleanOp: "or_max", terms };
}
