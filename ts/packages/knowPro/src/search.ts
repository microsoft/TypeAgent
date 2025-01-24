// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ITermToSemanticRefIndex, ScoredSemanticRef } from "./dataFormat.js";
import {
    QueryEvalContext,
    SelectTopTermMatchesExpr,
    TermsMatchExpr,
} from "./query.js";

export class SearchResult {
    constructor(
        public termMatches: string[] = [],
        public semanticRefMatches: ScoredSemanticRef[] = [],
    ) {}

    public get hasMatches(): boolean {
        return this.semanticRefMatches.length > 0;
    }
}

export function searchTermsInIndex(
    semanticRefIndex: ITermToSemanticRefIndex,
    terms: string[],
    maxMatches?: number,
): SearchResult {
    const context = new QueryEvalContext();
    const query = new SelectTopTermMatchesExpr(
        new TermsMatchExpr(semanticRefIndex, terms),
        maxMatches,
    );
    const evalResults = query.eval(context);
    return new SearchResult(
        evalResults.termMatches,
        evalResults.semanticRefMatches,
    );
}
