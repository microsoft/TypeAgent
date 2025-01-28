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
    if (!q.isConversationSearchable(conversation)) {
        return new SearchResult();
    }

    const context = new q.QueryEvalContext(conversation);
    const queryTerms = new q.QueryTermsExpr(terms);
    const query = new q.SelectTopNExpr(
        new q.TermsMatchExpr(
            conversation.relatedTermsIndex !== undefined
                ? new q.ResolveRelatedTermsExpr(queryTerms)
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
    if (!q.isConversationSearchable(conversation)) {
        return new SearchResult();
    }

    const context = new q.QueryEvalContext(conversation);
    const query = new q.SelectTopNExpr(
        new q.TermsMatchExpr(new q.QueryTermsExpr(terms)),
        maxMatches,
        minHitCount,
    );
    const evalResults = await query.eval(context);
    return new SearchResult(
        evalResults.termMatches,
        evalResults.toScoredSemanticRefs(),
    );
}
