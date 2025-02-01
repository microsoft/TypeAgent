// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SemanticRefAccumulator } from "./collections.js";
import {
    DateRange,
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
    dateRange?: DateRange;
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
        this.prepareTerms(terms, filter);

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
        termsMatchExpr = this.compileScope(termsMatchExpr, filter?.dateRange);
        if (filter !== undefined) {
            // Where clause
            termsMatchExpr = new q.WhereSemanticRefExpr(
                termsMatchExpr,
                this.compileFilter(filter),
            );
        }
        return termsMatchExpr;
    }

    private compileScope(
        termsMatchExpr: q.IQueryOpExpr<SemanticRefAccumulator>,
        dateRange?: DateRange,
    ): q.IQueryOpExpr<SemanticRefAccumulator> {
        // Always apply "tag match" scope... all text ranges that matched tags.. are in scope
        termsMatchExpr = new q.ScopeExpr(
            termsMatchExpr,
            [new q.KnowledgeTypePredicate("tag")],
            dateRange ? new q.TimestampScopeExpr(dateRange) : undefined,
        );
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

    private prepareTerms(queryTerms: QueryTerm[], filter?: SearchFilter): void {
        const termText = new Set<string>();
        termText.add("*");
        let i = 0;
        // Prepare terms and remove duplicates
        while (i < queryTerms.length) {
            const queryTerm = queryTerms[i];
            this.prepareTerm(queryTerm.term);
            if (termText.has(queryTerm.term.text)) {
                // Duplicate
                queryTerms.splice(i, 1);
            } else {
                if (queryTerm.relatedTerms !== undefined) {
                    queryTerm.relatedTerms.forEach((t) => this.prepareTerm(t));
                }
                termText.add(queryTerm.term.text);
                ++i;
            }
        }
        this.prepareFilter(filter);
        // Ensure that all filter name values are also query terms
        if (filter !== undefined && filter.propertiesToMatch) {
            for (const key of Object.keys(filter.propertiesToMatch)) {
                if (
                    !termText.has(key) &&
                    !SearchQueryBuilder.reservedPropertyNames.has(key)
                ) {
                    queryTerms.push({ term: { text: key } });
                }
                const value = filter.propertiesToMatch[key];
                if (!termText.has(value)) {
                    queryTerms.push({ term: { text: value } });
                }
            }
        }
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

    static reservedPropertyNames = new Set<string>([
        "name",
        "type",
        "topic",
        "tag",
        "verb",
        "subject",
        "object",
        "indirectObject ",
    ]);
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
