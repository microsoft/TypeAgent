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
} from "./interfaces.js";
import { PropertyNames } from "./propertyIndex.js";
import * as q from "./query.js";
import { createPropertySearchTerm } from "./searchLib.js";

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

export function compileMatchObjectOrEntity(targetEntityName: string) {
    const expr = new q.MatchMessagesOrExpr([
        new q.MatchPropertySearchTermExpr(
            createPropertySearchTerm(PropertyNames.Object, targetEntityName),
        ),
        new q.MatchPropertySearchTermExpr(
            createPropertySearchTerm(
                PropertyNames.EntityName,
                targetEntityName,
            ),
        ),
    ]);
    return expr;
}

export function compileMatchSubjectAndVerb(subject: string, verb: string) {
    let expr = new q.MatchMessagesAndExpr([
        new q.MatchPropertySearchTermExpr(
            createPropertySearchTerm(PropertyNames.Subject, subject),
        ),
        new q.MatchPropertySearchTermExpr(
            createPropertySearchTerm(PropertyNames.Verb, verb),
        ),
    ]);
    return expr;
}
export function isPropertyTerm(
    term: SearchTerm | PropertySearchTerm | SearchTermGroup,
): term is PropertySearchTerm {
    return term.hasOwnProperty("propertyName");
}

export function isEntityPropertyTerm(term: PropertySearchTerm): boolean {
    switch (term.propertyName) {
        default:
            break;
        case "name":
        case "type":
            return true;
    }
    return false;
}

export function isActionPropertyTerm(term: PropertySearchTerm): boolean {
    switch (term.propertyName) {
        default:
            break;
        case "subject":
        case "verb":
        case "object":
        case "indirectObject":
            return true;
    }

    return false;
}

export function isSearchGroupTerm(
    term: SearchTerm | PropertySearchTerm | SearchTermGroup,
): term is SearchTermGroup {
    return term.hasOwnProperty("booleanOp");
}
