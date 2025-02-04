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
    private allSearchTerms: SearchTerm[] = [];

    constructor(public conversation: IConversation) {}

    public compile(
        terms: SearchTerm[],
        propertyTerms?: Record<string, string>,
        filter?: SearchFilter,
        maxMatches?: number,
    ) {
        let selectExpr = this.compileSelect(terms, propertyTerms, filter);
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
            let qualifiedTerm: QualifiedSearchTerm | undefined;
            switch (propertyName) {
                default:
                    qualifiedTerm = {
                        type: "facet",
                        facetName: createSearchTerm(propertyName),
                        facetValue: createSearchTerm(propertyValue),
                    };
                    this.allSearchTerms.push(qualifiedTerm.facetName);
                    this.allSearchTerms.push(qualifiedTerm.facetValue);
                    break;
                case PropertyNames.EntityName:
                case PropertyNames.EntityType:
                case PropertyNames.Verb:
                case PropertyNames.Subject:
                case PropertyNames.Object:
                case PropertyNames.IndirectObject:
                    qualifiedTerm = {
                        type: "property",
                        propertyName: propertyName as KnowledgePropertyNames,
                        propertyValue: createSearchTerm(propertyValue),
                    };
                    this.allSearchTerms.push(qualifiedTerm.propertyValue);
                    break;
            }
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

    private async prepareSearchTerms(searchTerms: SearchTerm[]): Promise<void> {
        if (this.conversation.relatedTermsIndex) {
            await resolveRelatedTerms(
                this.conversation.relatedTermsIndex,
                searchTerms,
            );
        }
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
