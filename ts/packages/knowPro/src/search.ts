// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IConversation, ScoredSemanticRef } from "./dataFormat.js";
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

export async function searchTermsInConversation(
    conversation: IConversation,
    terms: q.QueryTerm[],
    maxMatches?: number,
    minHitCount?: number,
): Promise<SearchResult> {
    const semanticRefIndex = conversation.semanticRefIndex;
    if (semanticRefIndex === undefined) {
        return new SearchResult();
    }

    const relatedTermIndex = conversation.relatedTermsIndex;
    const context = new q.QueryEvalContext();
    const queryTerms = new q.QueryTermsExpr(terms);
    const query = new q.SelectTopNExpr(
        new q.TermsMatchExpr(
            semanticRefIndex,
            relatedTermIndex !== undefined
                ? new q.ResolveRelatedTermsExpr(relatedTermIndex, queryTerms)
                : queryTerms,
        ),
        maxMatches,
        minHitCount,
    );
    const evalResults = await query.eval(context);
    return new SearchResult(
        evalResults.termMatches,
        evalResults.toScoredSemanticRefs(),
    );
}

export async function searchTermsInConversationExact(
    conversation: IConversation,
    terms: q.QueryTerm[],
    maxMatches?: number,
    minHitCount?: number,
): Promise<SearchResult> {
    const semanticRefIndex = conversation.semanticRefIndex;
    if (semanticRefIndex === undefined) {
        return new SearchResult();
    }

    const context = new q.QueryEvalContext();
    const query = new q.SelectTopNExpr(
        new q.TermsMatchExpr(semanticRefIndex, new q.QueryTermsExpr(terms)),
        maxMatches,
        minHitCount,
    );
    const evalResults = await query.eval(context);
    return new SearchResult(
        evalResults.termMatches,
        evalResults.toScoredSemanticRefs(),
    );
}
