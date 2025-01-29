// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    KnowledgeType,
    QueryTerm,
    ScoredSemanticRef,
} from "./dataFormat.js";
import * as q from "./query.js";

export type SearchResult = {
    termMatches: Set<string>;
    semanticRefMatches: ScoredSemanticRef[];
};

/**
 * Searches conversation for terms
 * @param conversation
 * @param terms
 * @param maxMatches
 * @param minHitCount
 * @returns
 */
export async function searchTermsInConversation(
    conversation: IConversation,
    terms: QueryTerm[],
    maxMatches?: number,
    minHitCount?: number,
): Promise<Map<KnowledgeType, SearchResult> | undefined> {
    if (!q.isConversationSearchable(conversation)) {
        return undefined;
    }

    const context = new q.QueryEvalContext(conversation);
    const queryTerms = new q.QueryTermsExpr(terms);
    const query = new q.SelectTopNKnowledgeGroupExpr(
        new q.GroupByKnowledgeTypeExpr(
            new q.TermsMatchExpr(
                conversation.relatedTermsIndex !== undefined
                    ? new q.ResolveRelatedTermsExpr(queryTerms)
                    : queryTerms,
            ),
        ),
        maxMatches,
        minHitCount,
    );
    const evalResults = await query.eval(context);
    const semanticRefMatches = new Map<KnowledgeType, SearchResult>();
    for (const [type, accumulator] of evalResults) {
        if (accumulator.numMatches > 0) {
            semanticRefMatches.set(type, {
                termMatches: accumulator.queryTermMatches.termMatches,
                semanticRefMatches: accumulator.toScoredSemanticRefs(),
            });
        }
    }
    return semanticRefMatches;
}

export async function searchTermsInConversationExact(
    conversation: IConversation,
    terms: QueryTerm[],
    maxMatches?: number,
    minHitCount?: number,
): Promise<SearchResult | undefined> {
    if (!q.isConversationSearchable(conversation)) {
        return undefined;
    }

    const context = new q.QueryEvalContext(conversation);
    const query = new q.SelectTopNExpr(
        new q.TermsMatchExpr(new q.QueryTermsExpr(terms)),
        maxMatches,
        minHitCount,
    );
    const evalResults = await query.eval(context);
    return {
        termMatches: evalResults.queryTermMatches.termMatches,
        semanticRefMatches: evalResults.toScoredSemanticRefs(),
    };
}
