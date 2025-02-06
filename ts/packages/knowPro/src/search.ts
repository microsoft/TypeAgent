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
            score,
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
    // All SearchTerms injected which compiling the 'select' portion of the query
    // We will them expand these search terms by also including related terms
    private allSearchTerms: SearchTerm[] = [];

    constructor(public conversation: IConversation) {}

    public async compile(
        terms: SearchTerm[],
        propertyTerms?: Record<string, string>,
        filter?: SearchFilter,
        maxMatches?: number,
    ) {
        let query = this.compileQuery(terms, propertyTerms, filter);
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
        propertyTerms?: Record<string, string>,
        filter?: SearchFilter,
        maxMatches?: number,
    ) {
        let selectExpr = this.compileSelect(terms, propertyTerms, filter);
        // Constrain the select with scopes
        selectExpr = this.compileScope(selectExpr, filter?.dateRange);
        if (filter !== undefined) {
            // Further constrain with any filters
            selectExpr = new q.WhereSemanticRefExpr(
                selectExpr,
                this.compileFilter(filter),
            );
        }
        // And lastly, select 'TopN' and group knowledge by type
        return new q.SelectTopNKnowledgeGroupExpr(
            new q.GroupByKnowledgeTypeExpr(selectExpr),
            maxMatches,
        );
    }

    private compileSelect(
        terms: SearchTerm[],
        propertyTerms?: Record<string, string>,
        filter?: SearchFilter,
    ) {
        // Select is a combination of ordinary search terms and property search terms
        let matchTermsExpr = this.compileSearchTerms(terms);
        if (propertyTerms) {
            matchTermsExpr.push(...this.compilePropertyTerms(propertyTerms));
        }
        let selectExpr: q.IQueryOpExpr<SemanticRefAccumulator> =
            new q.GetSearchMatchesExpr(matchTermsExpr);

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

    private compilePropertyTerms(
        properties: Record<string, string>,
    ): q.MatchTermExpr[] {
        const matchExpressions: q.MatchPropertyTermExpr[] = [];
        for (const propertyName of Object.keys(properties)) {
            const propertyValue = properties[propertyName];
            const [propertySearchTerm, searchTermsCreated] =
                propertySearchTermFromKeyValue(propertyName, propertyValue);

            matchExpressions.push(
                new q.MatchPropertyTermExpr(propertySearchTerm),
            );
            this.allSearchTerms.push(...searchTermsCreated);
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

export function propertySearchTermFromKeyValue(
    key: string,
    value: string,
): [PropertySearchTerm, SearchTerm[]] {
    const searchTermsCreated: SearchTerm[] = [];
    let propertyName: KnowledgePropertyName | SearchTerm;
    let propertyValue: SearchTerm;
    switch (key) {
        default:
            propertyName = createSearchTerm(key);
            searchTermsCreated.push(propertyName);
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
    searchTermsCreated.push(propertyValue);
    return [{ propertyName, propertyValue }, searchTermsCreated];
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
