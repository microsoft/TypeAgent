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
import { PropertyNames } from "./propertyIndex.js";
import * as q from "./query.js";

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

export type KnowledgePropertyNames =
    | "name"
    | "type"
    | "verb"
    | "subject"
    | "object"
    | "indirectObject";

export interface PropertySearchTerm {
    type: "property";
    propertyName: KnowledgePropertyNames;
    propertyValue: SearchTerm;
}

export interface FacetSearchTerm {
    type: "facet";
    facetName: SearchTerm;
    facetValue: SearchTerm;
}

export interface TagSearchTerm {
    type: "tag";
    tagValue: SearchTerm;
}

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
    const query = queryBuilder.compile(
        searchTerms,
        propertyTerms,
        filter,
        maxMatches,
    );
    const queryResults = await query.eval(new q.QueryEvalContext(conversation));
    return toGroupedSearchResults(queryResults);
}

class SearchQueryBuilder {
    constructor(public conversation: IConversation) {}

    public compile(
        terms: SearchTerm[],
        propertyTerms?: Record<string, string>,
        filter?: SearchFilter,
        maxMatches?: number,
    ) {
        this.prepareTerms(terms, filter);

        let select = this.compileSelect(terms, propertyTerms, filter);
        const query = new q.SelectTopNKnowledgeGroupExpr(
            new q.GroupByKnowledgeTypeExpr(select),
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
            let searchTerm: QualifiedSearchTerm | undefined;
            switch (propertyName) {
                default:
                    searchTerm = {
                        type: "facet",
                        facetName: createSearchTerm(propertyName),
                        facetValue: createSearchTerm(propertyValue),
                    };
                    break;
                case PropertyNames.EntityName:
                case PropertyNames.EntityType:
                case PropertyNames.Verb:
                case PropertyNames.Subject:
                case PropertyNames.Object:
                case PropertyNames.IndirectObject:
                    searchTerm = {
                        type: "property",
                        propertyName: propertyName as KnowledgePropertyNames,
                        propertyValue: createSearchTerm(propertyValue),
                    };
                    break;
            }
            matchExpr = new q.MatchQualifiedSearchTermExpr(searchTerm);
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

    private prepareTerms(
        queryTerms: SearchTerm[],
        filter?: SearchFilter,
    ): void {
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
    }

    private prepareTerm(term: Term) {
        term.text = term.text.toLowerCase();
    }
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
