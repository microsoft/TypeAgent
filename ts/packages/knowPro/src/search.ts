// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SemanticRefAccumulator } from "./collections.js";
import {
    DateRange,
    IConversation,
    KnowledgeType,
    ScoredSemanticRef,
    Term,
} from "./dataFormat.js";
import * as q from "./query.js";
import { resolveRelatedTerms } from "./relatedTermsIndex.js";

export type SearchTerm = {
    /**
     * Term being searched for
     */
    term: Term;
    /**
     * Additional terms related to term.
     * These can be supplied from synonym tables and so on
     */
    relatedTerms?: Term[] | undefined;
};

export function createSearchTerm(text: string, score?: number): SearchTerm {
    return {
        term: {
            text,
            weight: score,
        },
    };
}

export type KnowledgePropertyName =
    | "name"
    | "type"
    | "verb"
    | "subject"
    | "object"
    | "indirectObject"
    | "tag";

export type PropertySearchTerm = {
    propertyName: KnowledgePropertyName | SearchTerm;
    propertyValue: SearchTerm;
};

export type SearchResult = {
    termMatches: Set<string>;
    semanticRefMatches: ScoredSemanticRef[];
};

export type SearchFilter = {
    type?: KnowledgeType | undefined;
    dateRange?: DateRange | undefined;
    propertyScope?: PropertySearchTerm[] | undefined;
};

/**
 * Searches conversation for terms
 */
export async function searchConversation(
    conversation: IConversation,
    searchTerms: SearchTerm[],
    propertyTerms?: PropertySearchTerm[],
    filter?: SearchFilter,
    maxMatches?: number,
    minHitCount?: number,
): Promise<Map<KnowledgeType, SearchResult> | undefined> {
    if (!q.isConversationSearchable(conversation)) {
        return undefined;
    }
    const queryBuilder = new SearchQueryBuilder(conversation);
    const query = await queryBuilder.compile(
        searchTerms,
        propertyTerms,
        filter,
        maxMatches,
        minHitCount,
    );
    const queryResults = query.eval(new q.QueryEvalContext(conversation));
    return toGroupedSearchResults(queryResults);
}

class SearchQueryBuilder {
    // All SearchTerms injected which compiling the 'select' portion of the query
    // We will them expand these search terms by also including related terms
    private allSearchTerms: SearchTerm[] = [];

    constructor(
        public conversation: IConversation,
        public defaultMatchWeight: number = 100,
        public relatedIsExactThreshold: number = 0.95,
    ) {}

    public async compile(
        terms: SearchTerm[],
        propertyTerms?: PropertySearchTerm[],
        filter?: SearchFilter,
        maxMatches?: number,
        minHitCount?: number,
    ) {
        let query = this.compileQuery(
            terms,
            propertyTerms,
            filter,
            maxMatches,
            minHitCount,
        );

        this.prepareSearchTerms(this.allSearchTerms);
        // For all individual SearchTerms created during query compilation, resolve any related terms
        if (this.conversation.termToRelatedTermsIndex) {
            await resolveRelatedTerms(
                this.conversation.termToRelatedTermsIndex,
                this.allSearchTerms,
            );
        }
        this.prepareSearchTerms(this.allSearchTerms);
        return query;
    }

    public async compileQuery(
        terms: SearchTerm[],
        propertyTerms?: PropertySearchTerm[],
        filter?: SearchFilter,
        maxMatches?: number,
        minHitCount?: number,
    ) {
        let selectExpr = this.compileSelect(terms, propertyTerms, filter);
        // Constrain the select with scopes and 'where'
        if (filter) {
            selectExpr = this.compileScope(selectExpr, filter);
            selectExpr = new q.WhereSemanticRefExpr(
                selectExpr,
                this.compileWhere(filter),
            );
        }
        // And lastly, select 'TopN' and group knowledge by type
        return new q.SelectTopNKnowledgeGroupExpr(
            new q.GroupByKnowledgeTypeExpr(selectExpr),
            maxMatches,
            minHitCount,
        );
    }

    private compileSelect(
        terms: SearchTerm[],
        propertyTerms?: PropertySearchTerm[],
        filter?: SearchFilter,
    ) {
        // Select is a combination of ordinary search terms and property search terms
        let matchTermsExpr = this.compileSearchTerms(terms);
        if (propertyTerms) {
            matchTermsExpr.push(
                ...this.compilePropertySearchTerms(propertyTerms),
            );
        }
        let selectExpr: q.IQueryOpExpr<SemanticRefAccumulator> =
            new q.MatchAllTermsExpr(matchTermsExpr);

        return selectExpr;
    }

    private compileSearchTerms(searchTerms: SearchTerm[]): q.MatchTermExpr[] {
        const matchExpressions: q.MatchSearchTermExpr[] = [];
        for (const searchTerm of searchTerms) {
            matchExpressions.push(new q.MatchSearchTermExpr(searchTerm));
            this.allSearchTerms.push(searchTerm);
        }
        return matchExpressions;
    }

    private compilePropertySearchTerms(
        propertyTerms: PropertySearchTerm[],
    ): q.MatchTermExpr[] {
        const matchExpressions: q.MatchPropertyTermExpr[] = [];
        for (const propertyTerm of propertyTerms) {
            matchExpressions.push(new q.MatchPropertyTermExpr(propertyTerm));
            if (typeof propertyTerm.propertyName !== "string") {
                this.allSearchTerms.push(propertyTerm.propertyName);
            }
            this.allSearchTerms.push(propertyTerm.propertyValue);
        }
        return matchExpressions;
    }

    private compileScope(
        termsMatchExpr: q.IQueryOpExpr<SemanticRefAccumulator>,
        filter: SearchFilter,
    ): q.IQueryOpExpr<SemanticRefAccumulator> {
        let scopeSelectors: q.IQuerySelectScopeExpr[] = [];
        // Always apply "tag match" scope... all text ranges that matched tags.. are in scope
        //scopePredicates.push(new q.KnowledgeTypePredicate("tag"));
        scopeSelectors.push(new q.TagScopeExpr());
        if (filter.propertyScope && filter.propertyScope.length > 0) {
            scopeSelectors.push(
                new q.PredicateScopeExpr(
                    this.compilePropertyMatchPredicates(filter.propertyScope),
                ),
            );
        }
        if (filter.dateRange) {
            scopeSelectors.push(new q.TimestampScopeExpr(filter.dateRange));
        }
        return new q.SelectScopeExpr(termsMatchExpr, scopeSelectors);
    }

    private compilePropertyMatchPredicates(
        propertyTerms: PropertySearchTerm[],
    ) {
        return propertyTerms.map((p) => new q.PropertyMatchPredicate(p));
    }

    private compileWhere(filter: SearchFilter): q.IQuerySemanticRefPredicate[] {
        let predicates: q.IQuerySemanticRefPredicate[] = [];
        if (filter.type) {
            predicates.push(new q.KnowledgeTypePredicate(filter.type));
        }
        return predicates;
    }

    private prepareSearchTerms(searchTerms: SearchTerm[]): void {
        for (const searchTerm of searchTerms) {
            this.prepareTerm(searchTerm.term);
            searchTerm.term.weight ??= this.defaultMatchWeight;
            if (searchTerm.relatedTerms) {
                searchTerm.relatedTerms.forEach((st) => {
                    if (
                        st.weight &&
                        st.weight >= this.relatedIsExactThreshold
                    ) {
                        st.weight = this.defaultMatchWeight;
                    }
                    this.prepareTerm(st);
                });
            }
        }
    }

    private prepareTerm(term: Term) {
        term.text = term.text.toLowerCase();
    }
}

export function propertySearchTermFromKeyValue(
    key: string,
    value: string,
): PropertySearchTerm {
    let propertyName: KnowledgePropertyName | SearchTerm;
    let propertyValue: SearchTerm;
    switch (key) {
        default:
            propertyName = createSearchTerm(key);
            break;
        case "name":
        case "type":
        case "verb":
        case "subject":
        case "object":
        case "indirectObject":
        case "tag":
            propertyName = key;
            break;
    }
    propertyValue = createSearchTerm(value);
    return { propertyName, propertyValue };
}

function toGroupedSearchResults(
    evalResults: Map<KnowledgeType, SemanticRefAccumulator>,
) {
    const semanticRefMatches = new Map<KnowledgeType, SearchResult>();
    for (const [type, accumulator] of evalResults) {
        if (accumulator.size > 0) {
            semanticRefMatches.set(type, {
                termMatches: accumulator.searchTermMatches,
                semanticRefMatches: accumulator.toScoredSemanticRefs(),
            });
        }
    }
    return semanticRefMatches;
}
