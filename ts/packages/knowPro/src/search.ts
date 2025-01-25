// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ITermToSemanticRefIndex, ScoredSemanticRef } from "./dataFormat.js";
import * as q from "./query.js";

export class SearchResult {
    constructor(
        public termMatches: Set<string> = new Set(),
        public semanticRefMatches: ScoredSemanticRef[] = [],
    ) {}

    public get hasMatches(): boolean {
        return this.semanticRefMatches.length > 0;
    }
}

export function searchTermsInIndex(
    semanticRefIndex: ITermToSemanticRefIndex,
    terms: q.QueryTerm[],
    maxMatches?: number,
    minHitCount?: number,
): SearchResult {
    const context = new q.QueryEvalContext();
    const query = new q.SelectTopNExpr(
        new q.TermsMatchExpr(semanticRefIndex, terms),
        maxMatches,
        minHitCount,
    );
    const evalResults = query.eval(context);
    return new SearchResult(
        evalResults.termMatches,
        evalResults.toScoredSemanticRefs(),
    );
}
