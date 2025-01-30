// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SemanticRefAccumulator } from "./accumulators.js";
import {
    IConversation,
    KnowledgeType,
    QueryTerm,
    ScoredSemanticRef,
    Term,
} from "./dataFormat.js";
import * as q from "./query.js";

export type SearchResult = {
    termMatches: Set<string>;
    semanticRefMatches: ScoredSemanticRef[];
};

export type SearchFilter = {
    type?: KnowledgeType | undefined;
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
        this.prepareTerms(terms);
        this.prepareFilter(filter);

        let select = this.compileSelect(terms, filter);
        const query = new q.SelectTopNKnowledgeGroupExpr(
            new q.GroupByKnowledgeTypeExpr(select),
            maxMatches,
        );
        return query;
    }

    private compileSelect(terms: QueryTerm[], filter?: SearchFilter) {
        const queryTerms = new q.QueryTermsExpr(terms);
        let termsMatchExpr: q.IQueryOpExpr<SemanticRefAccumulator> =
            new q.TermsMatchExpr(
                this.conversation.relatedTermsIndex !== undefined
                    ? new q.ResolveRelatedTermsExpr(queryTerms)
                    : queryTerms,
            );
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

    private prepareTerms(queryTerms: QueryTerm[]): void {
        queryTerms.forEach((queryTerm) => {
            this.prepareTerm(queryTerm.term);
            if (queryTerm.relatedTerms !== undefined) {
                queryTerm.relatedTerms.forEach((t) => this.prepareTerm(t));
            }
        });
    }

    private prepareTerm(term: Term) {
        term.text = term.text.toLowerCase();
    }

    private prepareFilter(filter?: SearchFilter) {
        if (filter !== undefined && filter.propertiesToMatch) {
            for (const key of Object.keys(filter.propertiesToMatch)) {
                filter.propertiesToMatch[key] =
                    filter.propertiesToMatch[key].toLowerCase();
            }
        }
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
