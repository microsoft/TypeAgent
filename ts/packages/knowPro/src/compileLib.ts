// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * INTERNAL TO LIBRARY
 * Query operators and processing is INTERNAL to the library and for testing
 * These should not be exposed via index.ts
 */

import { MessageAccumulator, SemanticRefAccumulator } from "./collections.js";
import {
    SearchTerm,
    PropertySearchTerm,
    SearchTermGroup,
    Term,
    SearchTermGroupTypes,
} from "./interfaces.js";
import * as q from "./query.js";
import { isPropertyTerm, isSearchGroupTerm } from "./searchLib.js";

export type BooleanOp = "and" | "or" | "or_max";

export function createMatchTermsBooleanExpr(
    termExpressions: q.IQueryOpExpr<SemanticRefAccumulator | undefined>[],
    booleanOp: BooleanOp,
    scopeExpr?: q.GetScopeExpr,
) {
    let boolExpr: q.MatchTermsBooleanExpr;
    switch (booleanOp) {
        case "and":
            boolExpr = new q.MatchTermsAndExpr(termExpressions, scopeExpr);
            break;
        case "or":
            boolExpr = new q.MatchTermsOrExpr(termExpressions, scopeExpr);
            break;
        case "or_max":
            boolExpr = new q.MatchTermsOrMaxExpr(termExpressions, scopeExpr);
            break;
    }
    return boolExpr;
}

export function createMatchMessagesBooleanExpr(
    termExpressions: q.IQueryOpExpr<
        SemanticRefAccumulator | MessageAccumulator | undefined
    >[],
    booleanOp: BooleanOp,
) {
    let boolExpr: q.MatchMessagesBooleanExpr;
    switch (booleanOp) {
        case "and":
            boolExpr = new q.MatchMessagesAndExpr(termExpressions);
            break;
        case "or":
            boolExpr = new q.MatchMessagesOrExpr(termExpressions);
            break;
        case "or_max":
            boolExpr = new q.MatchMessagesOrMaxExpr(termExpressions);
            break;
    }
    return boolExpr;
}

export function isEntityPropertyTerm(term: PropertySearchTerm): boolean {
    if (typeof term.propertyName === "string") {
        switch (term.propertyName) {
            default:
                break;
            case "name":
            case "type":
                return true;
        }
    }
    return false;
}

export function isActionPropertyTerm(term: PropertySearchTerm): boolean {
    if (typeof term.propertyName === "string") {
        switch (term.propertyName) {
            default:
                break;
            case "subject":
            case "verb":
            case "object":
            case "indirectObject":
                return true;
        }
    }

    return false;
}

export function validateSearchTermGroup(
    termGroup: SearchTermGroup,
): string | undefined {
    if (termGroup === undefined) {
        return "SearchTermGroup";
    }
    if (!termGroup.booleanOp) {
        return "booleanOp";
    }
    if (termGroup.terms === undefined || termGroup.terms.length === 0) {
        return `terms\n${JSON.stringify(termGroup)}`;
    }
    let error: string | undefined;
    let lastValid: SearchTermGroupTypes | undefined;
    for (let i = 0; i < termGroup.terms.length; ++i) {
        const term = termGroup.terms[i];
        if (isPropertyTerm(term)) {
            if (term.propertyName === undefined) {
                error = `propertyName\n${JSON.stringify(term)}`;
                break;
            }
            if (typeof term.propertyName !== "string") {
                error = validateSearchTerm(term.propertyName);
                if (error !== undefined) {
                    error = "propertyName\n" + error;
                    break;
                }
            }
            if (term.propertyValue === undefined) {
                error = `propertyValue\n${JSON.stringify(term)}`;
                break;
            }
            error = validateSearchTerm(term.propertyValue);
            if (error !== undefined) {
                error = "propertyValue\n" + error;
                break;
            }
        } else if (isSearchGroupTerm(term)) {
            error = validateSearchTermGroup(term);
        } else {
            error = validateSearchTerm(term);
        }
        if (error !== undefined) {
            break;
        }
        lastValid = term;
    }
    if (error !== undefined && lastValid !== undefined) {
        error += `\nLast valid term:\n${JSON.stringify(lastValid)}`;
    }
    return error;
}

function validateSearchTerm(term: SearchTerm): string | undefined {
    if (!validateTerm(term.term)) {
        return `Invalid SearchTerm\n${JSON.stringify(term)}`;
    }
    if (term.relatedTerms !== undefined && term.relatedTerms.length > 0) {
        for (let i = 0; i < term.relatedTerms.length; ++i) {
            let relatedTerm = term.relatedTerms[i];
            if (!validateTerm(relatedTerm)) {
                let error = `Invalid related term for:\n${JSON.stringify(term.term)}`;
                if (i > 0) {
                    error += `\nLast valid related term:\n${JSON.stringify(term.relatedTerms[i - 1])}`;
                }
                return error;
            }
        }
    }
    return undefined;
}

function validateTerm(term: Term): boolean {
    if (
        term === undefined ||
        term.text === undefined ||
        term.text.length === 0
    ) {
        return false;
    }
    return true;
}

export interface CompiledSearchTerm extends SearchTerm {
    /**
     * The compiler will eliminate overlapping related terms to reduce hit duplication.
     * This is because different search terms may end up with the same related terms.
     * However, we don' want to do this when the query includes explicit property matching
     */
    relatedTermsRequired?: boolean | undefined;
}

export function toRequiredSearchTerm(term: SearchTerm): CompiledSearchTerm {
    const compiledTerm: CompiledSearchTerm = term;
    compiledTerm.relatedTermsRequired = true;
    return compiledTerm;
}

export type CompiledTermGroup = {
    booleanOp: BooleanOp;
    terms: CompiledSearchTerm[];
};
