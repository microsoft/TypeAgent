// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SemanticRefAccumulator } from "./collections.js";
import {
    DateRange,
    IConversation,
    KnowledgeType,
    ScoredSemanticRef,
    SearchTerm,
    Term,
} from "./dataFormat.js";
import * as q from "./query.js";
import { resolveRelatedTerms } from "./relatedTermsIndex.js";
import { IConversationSecondaryIndexes } from "./secondaryIndexes.js";

/**
 * Well known knowledge properties
 */
export type KnowledgePropertyName =
    | "name" // the name of an entity
    | "type" // the type of an entity
    | "verb" // the verb of an action
    | "subject" // the subject of an action
    | "object" // the object of an action
    | "indirectObject" // The indirectObject of an action
    | "tag"; // Tag

export type PropertySearchTerm = {
    /**
     * You can either match a well known property name
     * Or you can provide a searchTerm for the propertyName.
     * E.g. to match hue(red)
     *  - propertyName as SearchTerm, set to 'hue'
     *  - propertyValue as SearchTerm, set to 'red'
     * You can also supply related terms for each.
     * E.g you could include "color" as a related term for the propertyName "hue". Or 'crimson' for red.
     * The the query processor can also related terms using a related terms secondary index, if one is available
     */
    propertyName: KnowledgePropertyName | SearchTerm;
    propertyValue: SearchTerm;
};

export type SearchTermGroup = {
    booleanOp: "and" | "or";
    terms: (SearchTerm | PropertySearchTerm)[];
};

function createSearchTerm(text: string, score?: number): SearchTerm {
    return {
        term: {
            text,
            weight: score,
        },
    };
}

export type WhenFilter = {
    knowledgeType?: KnowledgeType | undefined;
    inDateRange?: DateRange | undefined;
    scopingTerms?: PropertySearchTerm[] | undefined;
};

export type SearchOptions = {
    maxMatches?: number | undefined;
    exactMatch?: boolean | undefined;
    usePropertyIndex?: boolean | undefined;
    useTimestampIndex?: boolean | undefined;
};

export type SearchResult = {
    termMatches: Set<string>;
    semanticRefMatches: ScoredSemanticRef[];
};

/**
 * Searches conversation for terms
 */
export async function searchConversation(
    conversation: IConversation,
    searchTermGroup: SearchTermGroup,
    filter?: WhenFilter,
    options?: SearchOptions,
): Promise<Map<KnowledgeType, SearchResult> | undefined> {
    if (!q.isConversationSearchable(conversation)) {
        return undefined;
    }
    const secondaryIndexes: IConversationSecondaryIndexes = conversation as any;
    const queryBuilder = new SearchQueryBuilder(conversation, secondaryIndexes);
    const query = await queryBuilder.compile(searchTermGroup, filter, options);
    const queryResults = query.eval(
        new q.QueryEvalContext(
            conversation,
            options?.usePropertyIndex
                ? secondaryIndexes.propertyToSemanticRefIndex
                : undefined,
            options?.useTimestampIndex
                ? secondaryIndexes.timestampIndex
                : undefined,
        ),
    );
    return toGroupedSearchResults(queryResults);
}

class SearchQueryBuilder {
    // All SearchTerms used which compiling the 'select' portion of the query
    // We will them expand these search terms by also including related terms
    private allSearchTerms: SearchTerm[] = [];
    // All search terms used while compiling predicates in the query
    private allPredicateSearchTerms: SearchTerm[] = [];

    constructor(
        public conversation: IConversation,
        public secondaryIndexes?: IConversationSecondaryIndexes | undefined,
        public defaultMatchWeight: number = 100,
        public relatedIsExactThreshold: number = 0.95,
    ) {}

    public async compile(
        terms: SearchTermGroup,
        filter?: WhenFilter,
        options?: SearchOptions,
    ) {
        let query = this.compileQuery(terms, filter, options);

        const exactMatch = options?.exactMatch ?? false;
        if (!exactMatch) {
            // For all individual SearchTerms created during query compilation, resolve any related terms
            await this.resolveRelatedTerms(this.allSearchTerms, true);
            await this.resolveRelatedTerms(this.allPredicateSearchTerms, false);
        }

        return query;
    }

    public async compileQuery(
        termGroup: SearchTermGroup,
        filter?: WhenFilter,
        options?: SearchOptions,
    ) {
        let selectExpr = this.compileSelect(termGroup, options);
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
            options?.maxMatches,
        );
    }

    private compileSelect(termGroup: SearchTermGroup, options?: SearchOptions) {
        // Select is a combination of ordinary search terms and property search terms
        let selectExpr = this.compileSearchGroup(termGroup);
        return selectExpr;
    }

    private compileSearchGroup(
        searchGroup: SearchTermGroup,
    ): q.IQueryOpExpr<SemanticRefAccumulator> {
        const termExpressions: q.MatchTermExpr[] = [];
        for (const term of searchGroup.terms) {
            if (isPropertyTerm(term)) {
                termExpressions.push(new q.MatchPropertySearchTermExpr(term));
                if (typeof term.propertyName !== "string") {
                    this.allSearchTerms.push(term.propertyName);
                }
                this.allSearchTerms.push(term.propertyValue);
            } else {
                termExpressions.push(new q.MatchSearchTermExpr(term));
                this.allSearchTerms.push(term);
            }
        }
        return searchGroup.booleanOp === "and"
            ? new q.MatchTermsAndExpr(termExpressions)
            : new q.MatchTermsOrExpr(termExpressions);
    }

    private compileScope(
        termsMatchExpr: q.IQueryOpExpr<SemanticRefAccumulator>,
        filter: WhenFilter,
    ): q.IQueryOpExpr<SemanticRefAccumulator> {
        let scopeSelectors: q.IQueryTextRangeSelector[] = [];
        // Always apply "tag match" scope... all text ranges that matched tags.. are in scope
        scopeSelectors.push(new q.TextRangesWithTagSelector());
        if (filter.scopingTerms && filter.scopingTerms.length > 0) {
            scopeSelectors.push(
                new q.TextRangesPredicateSelector(
                    this.compilePropertyMatchPredicates(filter.scopingTerms),
                ),
            );
        }
        if (filter.inDateRange) {
            scopeSelectors.push(
                new q.TextRangesInDateRangeSelector(filter.inDateRange),
            );
        }
        return new q.SelectInScopeExpr(termsMatchExpr, scopeSelectors);
    }

    private compilePropertyMatchPredicates(
        propertyTerms: PropertySearchTerm[],
    ) {
        return propertyTerms.map((p) => {
            if (typeof p.propertyName !== "string") {
                this.allPredicateSearchTerms.push(p.propertyName);
            }
            this.allPredicateSearchTerms.push(p.propertyValue);
            return new q.PropertyMatchPredicate(p);
        });
    }

    private compileWhere(filter: WhenFilter): q.IQuerySemanticRefPredicate[] {
        let predicates: q.IQuerySemanticRefPredicate[] = [];
        if (filter.knowledgeType) {
            predicates.push(new q.KnowledgeTypePredicate(filter.knowledgeType));
        }
        return predicates;
    }

    private async resolveRelatedTerms(
        searchTerms: SearchTerm[],
        dedupe: boolean,
    ) {
        this.validateAndPrepareSearchTerms(searchTerms);
        if (this.secondaryIndexes?.termToRelatedTermsIndex) {
            await resolveRelatedTerms(
                this.secondaryIndexes.termToRelatedTermsIndex,
                searchTerms,
                dedupe,
            );
            // Ensure that the resolved terms are valid etc.
            this.validateAndPrepareSearchTerms(searchTerms);
        }
    }

    private validateAndPrepareSearchTerms(searchTerms: SearchTerm[]): void {
        for (const searchTerm of searchTerms) {
            this.validateAndPrepareSearchTerm(searchTerm);
        }
    }

    private validateAndPrepareSearchTerm(searchTerm: SearchTerm): boolean {
        if (!this.validateAndPrepareTerm(searchTerm.term)) {
            return false;
        }
        searchTerm.term.weight ??= this.defaultMatchWeight;
        if (searchTerm.relatedTerms) {
            for (const relatedTerm of searchTerm.relatedTerms) {
                if (!this.validateAndPrepareTerm(relatedTerm)) {
                    return false;
                }
                if (
                    relatedTerm.weight &&
                    relatedTerm.weight >= this.relatedIsExactThreshold
                ) {
                    relatedTerm.weight = this.defaultMatchWeight;
                }
            }
            searchTerm.relatedTerms.forEach((st) => {});
        }
        return true;
    }

    /**
     * Currently, just changes the case of a term
     *  But here, we may do other things like:
     * - Check for noise terms
     * - Do additional rewriting
     * - Additional checks that *reject* certain search terms
     * Return false if the term should be rejected
     */
    private validateAndPrepareTerm(term: Term | undefined): boolean {
        if (term) {
            term.text = term.text.toLowerCase();
        }
        return true;
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

function isPropertyTerm(
    term: SearchTerm | PropertySearchTerm,
): term is PropertySearchTerm {
    return term.hasOwnProperty("propertyName");
}
