// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SemanticRefAccumulator } from "./accumulators.js";
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
export async function searchConversation(
    conversation: IConversation,
    terms: QueryTerm[],
    type?: KnowledgeType,
    maxMatches?: number,
): Promise<Map<KnowledgeType, SearchResult> | undefined> {
    if (!q.isConversationSearchable(conversation)) {
        return undefined;
    }

    const context = new q.QueryEvalContext(conversation);
    const query = createTermSearchQuery(
        conversation,
        terms,
        type ? [new q.KnowledgeTypePredicate(type)] : undefined,
        maxMatches,
    );
    return toGroupedSearchResults(await query.eval(context));
}

export async function searchConversationExact(
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

function createTermSearchQuery(
    conversation: IConversation,
    terms: QueryTerm[],
    wherePredicates?: q.IQuerySemanticRefPredicate[] | undefined,
    maxMatches?: number,
    minHitCount?: number,
) {
    const queryTerms = new q.QueryTermsExpr(terms);
    let termsMatchExpr: q.IQueryOpExpr<SemanticRefAccumulator> =
        new q.TermsMatchExpr(
            conversation.relatedTermsIndex !== undefined
                ? new q.ResolveRelatedTermsExpr(queryTerms)
                : queryTerms,
        );
    if (wherePredicates !== undefined && wherePredicates.length > 0) {
        termsMatchExpr = new q.WhereSemanticRefExpr(
            termsMatchExpr,
            wherePredicates,
        );
    }
    const query = new q.SelectTopNKnowledgeGroupExpr(
        new q.GroupByKnowledgeTypeExpr(termsMatchExpr),
        maxMatches,
        minHitCount,
    );
    return query;
}

function toGroupedSearchResults(
    evalResults: Map<KnowledgeType, SemanticRefAccumulator>,
) {
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
