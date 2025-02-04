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
    term: Term;
    /**
     * These can be supplied from fuzzy synonym tables and so on
     */
    relatedTerms?: Term[] | undefined;
};

export function createSearchTerm(text: string, score?: number): SearchTerm {
    return {
        term: {
            text,
            score,
        },
    };
}

export type QualifiedSearchTerm = PropertySearchTerm | FacetSearchTerm;

export type KnowledgePropertyName =
    | "name"
    | "type"
    | "verb"
    | "subject"
    | "object"
    | "indirectObject"
    | "tag";

export type PropertySearchTerm = {
    type: "property";
    propertyName: KnowledgePropertyName;
    propertyValue: SearchTerm;
};

export type FacetSearchTerm = {
    type: "facet";
    facetName: SearchTerm;
    facetValue: SearchTerm;
};

export type SearchResult = {
    termMatches: Set<string>;
    semanticRefMatches: ScoredSemanticRef[];
};

export type SearchFilter = {
    type?: KnowledgeType | undefined;
    dateRange?: DateRange;
};
/**
 * Searches conversation for terms
 * @param conversation
 * @param searchTerms
 * @param maxMatches
 * @param minHitCount
 * @returns
 */
export async function searchConversation(
    conversation: IConversation,
    searchTerms: SearchTerm[],
    propertyTerms?: Record<string, string>,
    filter?: SearchFilter,
    maxMatches?: number,
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
    );
    const queryResults = query.eval(new q.QueryEvalContext(conversation));
    return toGroupedSearchResults(queryResults);
}

class SearchQueryBuilder {
    private allSearchTerms: SearchTerm[] = [];

    constructor(public conversation: IConversation) {}

    public async compile(
        terms: SearchTerm[],
        propertyTerms?: Record<string, string>,
        filter?: SearchFilter,
        maxMatches?: number,
    ) {
        let selectExpr = this.compileSelect(terms, propertyTerms, filter);
        // Resolve related terms for all search terms, as needed
        if (this.conversation.termToRelatedTermsIndex) {
            await resolveRelatedTerms(
                this.conversation.termToRelatedTermsIndex,
                this.allSearchTerms,
            );
        }
        this.prepareSearchTerms(this.allSearchTerms);
        const query = new q.SelectTopNKnowledgeGroupExpr(
            new q.GroupByKnowledgeTypeExpr(selectExpr),
            maxMatches,
        );
        return query;
    }

    private compileSelect(
        terms: SearchTerm[],
        propertyTerms?: Record<string, string>,
        filter?: SearchFilter,
    ) {
        let matchTermsExpr: q.QueryTermExpr[] = this.compileSearchTerms(terms);
        if (propertyTerms) {
            matchTermsExpr.push(...this.compilePropertyTerms(propertyTerms));
        }
        let selectExpr: q.IQueryOpExpr<SemanticRefAccumulator> =
            new q.MatchTermsExpr(matchTermsExpr);
        // Always apply "tag match" scope... all text ranges that matched tags.. are in scope
        selectExpr = this.compileScope(selectExpr, filter?.dateRange);
        if (filter !== undefined) {
            // Where clause
            selectExpr = new q.WhereSemanticRefExpr(
                selectExpr,
                this.compileFilter(filter),
            );
        }
        return selectExpr;
    }

    private compileSearchTerms(
        searchTerms: SearchTerm[],
    ): q.MatchSearchTermExpr[] {
        const matchExpressions: q.MatchSearchTermExpr[] = [];
        for (const searchTerm of searchTerms) {
            matchExpressions.push(new q.MatchSearchTermExpr(searchTerm));
            this.allSearchTerms.push(searchTerm);
        }
        return matchExpressions;
    }

    private compilePropertyTerms(
        properties: Record<string, string>,
    ): q.MatchQualifiedSearchTermExpr[] {
        const matchExpressions: q.MatchQualifiedSearchTermExpr[] = [];

        for (const propertyName of Object.keys(properties)) {
            const propertyValue = properties[propertyName];
            let matchExpr: q.MatchQualifiedSearchTermExpr | undefined;
            const [qualifiedTerm, searchTermsCreated] =
                qualifiedSearchTermFromKeyValue(propertyName, propertyValue);
            this.allSearchTerms.push(...searchTermsCreated);
            matchExpr = new q.MatchQualifiedSearchTermExpr(qualifiedTerm);
            matchExpressions.push(matchExpr);
        }
        return matchExpressions;
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
        return predicates;
    }

    private prepareSearchTerms(searchTerms: SearchTerm[]): void {
        for (const searchTerm of searchTerms) {
            this.prepareTerm(searchTerm.term);
            if (searchTerm.relatedTerms) {
                searchTerm.relatedTerms.forEach((st) => this.prepareTerm(st));
            }
        }
    }

    private prepareTerm(term: Term) {
        term.text = term.text.toLowerCase();
    }
}

export function qualifiedSearchTermFromKeyValue(
    key: string,
    value: string,
): [QualifiedSearchTerm, SearchTerm[]] {
    let qualifiedSearchTerm: QualifiedSearchTerm | undefined;
    const searchTermsCreated: SearchTerm[] = [];
    switch (key) {
        default:
            qualifiedSearchTerm = {
                type: "facet",
                facetName: createSearchTerm(key),
                facetValue: createSearchTerm(value),
            };
            searchTermsCreated.push(qualifiedSearchTerm.facetName);
            searchTermsCreated.push(qualifiedSearchTerm.facetValue);
            break;
        case "name":
        case "type":
        case "verb":
        case "subject":
        case "object":
        case "indirectObject":
        case "tag":
            qualifiedSearchTerm = {
                type: "property",
                propertyName: key as KnowledgePropertyName,
                propertyValue: createSearchTerm(value),
            };
            searchTermsCreated.push(qualifiedSearchTerm.propertyValue);
            break;
    }
    return [qualifiedSearchTerm, searchTermsCreated];
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
