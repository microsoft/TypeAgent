// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * INTERNAL TO LIBRARY
 * Query operators and processing is INTERNAL to the library.
 * These should not be exposed via index.ts
 */

import { PropertyNames } from "./propertyIndex.js";
import * as q from "./query.js";
import { createPropertySearchTerm } from "./searchLib.js";

export function createMatchObjectOrEntity(targetEntityName: string) {
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

export function createMatchSubjectAndVerb(subject: string, verb: string) {
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
