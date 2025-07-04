// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * INTERNAL LIBRARY
 * Functions that help with creating search and property terms
 */

import {
    KnowledgePropertyName,
    PropertySearchTerm,
    SearchTerm,
    SearchTermGroup,
    SearchTermGroupTypes,
} from "./interfaces.js";
import * as kpLib from "knowledge-processor";
import { PropertyNames } from "./propertyIndex.js";

/**
 * Create a search term with an optional weight
 * @param text term text
 * @param weight optional weight for the term
 * @returns {SearchTerm}
 */
export function createSearchTerm(
    text: string,
    weight?: number,
    exactMatchValue: boolean = false,
): SearchTerm {
    return {
        term: {
            text,
            weight,
        },
        relatedTerms: exactMatchValue ? [] : undefined,
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
        case "topic":
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

/**
 * Create a term group whose matches are intersected
 * @param terms
 * @returns
 */
export function createAndTermGroup(
    ...terms: SearchTermGroupTypes[]
): SearchTermGroup {
    terms ??= [];
    return { booleanOp: "and", terms };
}

/**
 * Create a term group whose matches are union-ed
 * @param terms
 * @returns
 */
export function createOrTermGroup(
    ...terms: SearchTermGroupTypes[]
): SearchTermGroup {
    terms ??= [];
    return { booleanOp: "or", terms };
}

/**
 * Create an or_max search group
 * @param terms
 * @returns
 */
export function createOrMaxTermGroup(
    ...terms: SearchTermGroupTypes[]
): SearchTermGroup {
    terms ??= [];
    return { booleanOp: "or_max", terms };
}

/**
 * Create an array of SearchTerms from the given term strings.
 * You can also provide related terms for each term string by using the following syntax
 *  'novel;book;bestseller': Here, 'book' and 'bestseller' become related terms for 'novel'
 * @param terms term text, with optional embedded related terms
 * @returns {SearchTerm[]}
 */
export function createSearchTerms(terms: string[]): SearchTerm[] {
    const searchTerms: SearchTerm[] = [];
    for (const term of terms) {
        const searchTerm = parseSearchTerm(term);
        if (searchTerm) {
            searchTerms.push(searchTerm);
        }
    }
    return searchTerms;
}

function parseSearchTerm(text: string): SearchTerm | undefined {
    let termStrings = splitTermValues(text, ";");
    if (termStrings.length > 0) {
        termStrings = termStrings.map((t) => t.toLowerCase());
        const searchTerm: SearchTerm = {
            term: { text: termStrings[0] },
        };
        if (termStrings.length > 1) {
            searchTerm.relatedTerms = [];
            for (let i = 1; i < termStrings.length; ++i) {
                searchTerm.relatedTerms.push({ text: termStrings[i] });
            }
        }
        return searchTerm;
    }
    return undefined;
}

/**
 * Create property search from the given record of name, value pairs
 * To search for multiple values for same property name, the value should be a ',' separated list of sub values
 * @param propertyNameValues
 * @returns
 */
export function createPropertySearchTerms(
    propertyNameValues: Record<string, string>,
): PropertySearchTerm[] {
    const propertySearchTerms: PropertySearchTerm[] = [];
    const propertyNames = Object.keys(propertyNameValues);
    for (const propertyName of propertyNames) {
        const allValues = splitTermValues(
            propertyNameValues[propertyName],
            ",",
        );
        for (const value of allValues) {
            propertySearchTerms.push(
                createPropertySearchTerm(propertyName, value),
            );
        }
    }
    return propertySearchTerms;
}

export function createTagSearchTermGroup(tags: string[]): SearchTermGroup {
    const termGroup = createOrMaxTermGroup();
    for (const tag of tags) {
        termGroup.terms.push(
            createPropertySearchTerm(PropertyNames.Tag, tag, true),
        );
    }
    return termGroup;
}

function splitTermValues(term: string, splitChar: string): string[] {
    let allTermStrings = kpLib.split(term, splitChar, {
        trim: true,
        removeEmpty: true,
    });
    return allTermStrings;
}

export function createMultipleChoiceQuestion(
    question: string,
    choices: string[],
    addNone: boolean = true,
): string {
    let text = question;
    if (choices.length > 0) {
        text = `Multiple choice question:\n${question}\n`;
        text += "Answer using *one or more* of the following choices *only*:\n";
        for (let i = 0; i < choices.length; ++i) {
            text += `- ${choices[i].trim()}\n`;
        }
        if (addNone) {
            text += "- None of the above\n";
        }
    }
    return text;
}
