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

export type SearchFilter = {
    type?: KnowledgeType;
    speaker?: string;
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
    filter?: SearchFilter,
    maxMatches?: number,
): Promise<Map<KnowledgeType, SearchResult> | undefined> {
    if (!q.isConversationSearchable(conversation)) {
        return undefined;
    }

    const context = new q.QueryEvalContext(conversation);
    const query = createTermSearchQuery(
        conversation,
        terms,
        filter,
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
    filter?: SearchFilter,
    maxMatches?: number,
    minHitCount?: number,
) {
    let where: q.IQuerySemanticRefPredicate[] | undefined;
    if (filter !== undefined) {
        where = [];
        if (filter.type) {
            where.push(new q.KnowledgeTypePredicate(filter.type));
        }
        if (filter.speaker) {
            where.push(new q.ActionPredicate(filter.speaker));
        }
    }
    const query = new q.SelectTopNKnowledgeGroupExpr(
        new q.GroupByKnowledgeTypeExpr(
            createTermsMatch(conversation, terms, where),
        ),
        maxMatches,
        minHitCount,
    );
    return query;
}

function createTermsMatch(
    conversation: IConversation,
    terms: QueryTerm[],
    wherePredicates?: q.IQuerySemanticRefPredicate[] | undefined,
) {
    const queryTerms = new q.QueryTermsExpr(terms);
    let termsMatchExpr: q.IQueryOpExpr<SemanticRefAccumulator> =
        new q.TermsMatchExpr(
            conversation.relatedTermsIndex !== undefined
                ? new q.ResolveRelatedTermsExpr(queryTerms)
                : queryTerms,
        );
    termsMatchExpr = new q.ScopeExpr(termsMatchExpr, [
        new q.KnowledgeTypePredicate("tag"),
    ]);
    if (wherePredicates !== undefined && wherePredicates.length > 0) {
        termsMatchExpr = new q.WhereSemanticRefExpr(
            termsMatchExpr,
            wherePredicates,
        );
    }
    return termsMatchExpr;
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
