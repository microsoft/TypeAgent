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
    propertiesToMatch?: Record<string, string>;
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
    const queryBuilder = new SearchQueryBuilder(conversation);
    const query = queryBuilder.compile(terms, filter, maxMatches);
    const queryResults = await query.eval(new q.QueryEvalContext(conversation));
    return toGroupedSearchResults(queryResults);
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

class SearchQueryBuilder {
    constructor(public conversation: IConversation) {}

    public compile(
        terms: QueryTerm[],
        filter?: SearchFilter,
        maxMatches?: number,
    ) {
        const query = new q.SelectTopNKnowledgeGroupExpr(
            new q.GroupByKnowledgeTypeExpr(this.compileSelect(terms, filter)),
            maxMatches,
        );
        return query;
    }

    private compileSelect(terms: QueryTerm[], filter?: SearchFilter) {
        let termsMatchExpr = this.compileTermLookup(terms);
        // Always apply "tag match" scope... all text ranges that matched tags.. are in scope
        termsMatchExpr = new q.ScopeExpr(termsMatchExpr, [
            new q.KnowledgeTypePredicate("tag"),
        ]);
        if (filter !== undefined) {
            // Where clause
            termsMatchExpr = new q.WhereSemanticRefExpr(
                termsMatchExpr,
                this.compileFilter(filter),
            );
        }
        return termsMatchExpr;
    }

    private compileTermLookup(
        terms: QueryTerm[],
    ): q.IQueryOpExpr<SemanticRefAccumulator> {
        const queryTerms = new q.QueryTermsExpr(terms);
        return new q.TermsMatchExpr(
            this.conversation.relatedTermsIndex !== undefined
                ? new q.ResolveRelatedTermsExpr(queryTerms)
                : queryTerms,
        );
    }

    private compileFilter(
        filter: SearchFilter,
    ): q.IQuerySemanticRefPredicate[] {
        let predicates: q.IQuerySemanticRefPredicate[] = [];
        if (filter.type) {
            predicates.push(new q.KnowledgeTypePredicate(filter.type));
        }
        if (filter.propertiesToMatch) {
            predicates.push(
                new q.PropertyMatchPredicate(filter.propertiesToMatch),
            );
        }
        return predicates;
    }
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
