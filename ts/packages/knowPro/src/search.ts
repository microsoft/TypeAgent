// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SemanticRefAccumulator } from "./collections.js";
import {
    DateRange,
    IConversation,
    KnowledgeType,
    ScoredKnowledge,
    ScoredSemanticRef,
    SemanticRef,
    Term,
    IConversationSecondaryIndexes,
} from "./interfaces.js";
import { mergedEntities, mergeTopics } from "./knowledge.js";
import * as q from "./query.js";
import { IQueryOpExpr } from "./query.js";
import { resolveRelatedTerms } from "./relatedTermsIndex.js";
import { conversation as kpLib } from "knowledge-processor";
import { PromptSection } from "typechat";

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

/**
 * A Group of search terms
 */
export type SearchTermGroup = {
    /**
     * And will enforce that all terms match
     */
    booleanOp: "and" | "or";
    terms: (SearchTerm | PropertySearchTerm)[];
};

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
     * PropertySearch terms let you matched named property, values
     * - You can  match a well known property name (name("Bach") type("book"))
     * - Or you can provide a SearchTerm as a propertyName.
     *   E.g. to match hue(red)
     *      - propertyName as SearchTerm, set to 'hue'
     *      - propertyValue as SearchTerm, set to 'red'
     * SearchTerms can included related terms
     *   E.g you could include "color" as a related term for the propertyName "hue". Or 'crimson' for red.
     * The the query processor can also related terms using a related terms secondary index, if one is available
     */
    propertyName: KnowledgePropertyName | SearchTerm;
    propertyValue: SearchTerm;
};

export function createSearchTerm(text: string, score?: number): SearchTerm {
    return {
        term: {
            text,
            weight: score,
        },
    };
}

export function createPropertySearchTerm(
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

export type WhenFilter = {
    knowledgeType?: KnowledgeType | undefined;
    dateRange?: DateRange | undefined;
    threadDescription?: string | undefined;
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
    const secondaryIndexes: IConversationSecondaryIndexes =
        conversation.secondaryIndexes ?? {};
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
    return queryResults;
}

export function getDistinctEntityMatches(
    semanticRefs: SemanticRef[],
    searchResults: ScoredSemanticRef[],
    topK?: number,
): ScoredKnowledge[] {
    return mergedEntities(semanticRefs, searchResults, topK);
}

export function getDistinctTopicMatches(
    semanticRefs: SemanticRef[],
    searchResults: ScoredSemanticRef[],
    topK?: number,
): ScoredKnowledge[] {
    return mergeTopics(semanticRefs, searchResults, topK);
}

class SearchQueryBuilder {
    // All SearchTerms used which compiling the 'select' portion of the query
    private allSearchTerms: SearchTerm[] = [];
    // All search terms used while compiling predicates in the query
    private allPredicateSearchTerms: SearchTerm[] = [];
    private allScopeSearchTerms: SearchTerm[] = [];

    constructor(
        public conversation: IConversation,
        public secondaryIndexes?: IConversationSecondaryIndexes | undefined,
        public entityTermMatchWeight: number = 100,
        public defaultTermMatchWeight: number = 10,
        public relatedIsExactThreshold: number = 0.95,
    ) {}

    public async compile(
        terms: SearchTermGroup,
        filter?: WhenFilter,
        options?: SearchOptions,
    ) {
        let query = await this.compileQuery(terms, filter, options);

        const exactMatch = options?.exactMatch ?? false;
        if (!exactMatch) {
            // For all individual SearchTerms created during query compilation, resolve any related terms
            await this.resolveRelatedTerms(this.allSearchTerms, true);
            await this.resolveRelatedTerms(this.allPredicateSearchTerms, false);
            await this.resolveRelatedTerms(this.allScopeSearchTerms, false);
        }

        return new q.GroupSearchResultsExpr(query);
    }

    public async compileQuery(
        searchTermGroup: SearchTermGroup,
        filter?: WhenFilter,
        options?: SearchOptions,
    ): Promise<IQueryOpExpr<Map<KnowledgeType, SemanticRefAccumulator>>> {
        let selectExpr = this.compileSelect(
            searchTermGroup,
            filter
                ? await this.compileScope(searchTermGroup, filter)
                : undefined,
            options,
        );
        // Constrain the select with scopes and 'where'
        if (filter) {
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

    private compileSelect(
        termGroup: SearchTermGroup,
        scopeExpr?: q.GetScopeExpr,
        options?: SearchOptions,
    ) {
        // Select is a combination of ordinary search terms and property search terms
        let [searchTermUsed, selectExpr] = this.compileSearchGroup(
            termGroup,
            scopeExpr,
        );
        this.allSearchTerms.push(...searchTermUsed);
        return selectExpr;
    }

    private compileSearchGroup(
        searchGroup: SearchTermGroup,
        scopeExpr?: q.GetScopeExpr,
    ): [SearchTerm[], q.IQueryOpExpr<SemanticRefAccumulator>] {
        const searchTermsUsed: SearchTerm[] = [];
        const termExpressions: q.MatchTermExpr[] = [];
        for (const term of searchGroup.terms) {
            if (isPropertyTerm(term)) {
                termExpressions.push(new q.MatchPropertySearchTermExpr(term));
                if (typeof term.propertyName !== "string") {
                    searchTermsUsed.push(term.propertyName);
                }
                if (isEntityPropertyTerm(term)) {
                    term.propertyValue.term.weight ??=
                        this.entityTermMatchWeight;
                }
                searchTermsUsed.push(term.propertyValue);
            } else {
                termExpressions.push(
                    new q.MatchSearchTermExpr(term, (term, sr, scored) =>
                        this.boostEntities(term, sr, scored, 10),
                    ),
                );
                searchTermsUsed.push(term);
            }
        }
        return [
            searchTermsUsed,
            searchGroup.booleanOp === "and"
                ? new q.MatchTermsAndExpr(termExpressions, scopeExpr)
                : new q.MatchTermsOrExpr(termExpressions, scopeExpr),
        ];
    }

    private async compileScope(
        searchGroup: SearchTermGroup,
        filter: WhenFilter,
    ): Promise<q.GetScopeExpr | undefined> {
        let scopeSelectors: q.IQueryTextRangeSelector[] | undefined;
        // First, use any provided date ranges to select scope
        if (filter.dateRange) {
            scopeSelectors ??= [];
            scopeSelectors.push(
                new q.TextRangesInDateRangeSelector(filter.dateRange),
            );
        }
        // Actions are inherently scope selecting. If any present in the query, use them
        // to restrict scope
        const actionTermsGroup =
            this.getActionTermsFromSearchGroup(searchGroup);
        if (actionTermsGroup) {
            scopeSelectors ??= [];
            const [searchTermsUsed, selectExpr] =
                this.compileSearchGroup(actionTermsGroup);
            scopeSelectors.push(
                new q.TextRangesWithTermMatchesSelector(selectExpr),
            );
            this.allScopeSearchTerms.push(...searchTermsUsed);
        }
        // If a thread index is available...
        const threads = this.secondaryIndexes?.threads;
        if (filter.threadDescription && threads) {
            const threadsInScope = await threads.lookupThread(
                filter.threadDescription,
            );
            if (threadsInScope) {
                scopeSelectors ??= [];
                scopeSelectors.push(
                    new q.ThreadSelector(
                        threadsInScope.map(
                            (t) => threads.threads[t.threadIndex],
                        ),
                    ),
                );
            }
        }
        return scopeSelectors ? new q.GetScopeExpr(scopeSelectors) : undefined;
    }

    private compileWhere(filter: WhenFilter): q.IQuerySemanticRefPredicate[] {
        let predicates: q.IQuerySemanticRefPredicate[] = [];
        if (filter.knowledgeType) {
            predicates.push(new q.KnowledgeTypePredicate(filter.knowledgeType));
        }
        return predicates;
    }

    /*
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
    */

    private getActionTermsFromSearchGroup(
        searchGroup: SearchTermGroup,
    ): SearchTermGroup | undefined {
        let actionGroup: SearchTermGroup | undefined;
        for (const term of searchGroup.terms) {
            if (isPropertyTerm(term) && isActionPropertyTerm(term)) {
                actionGroup ??= {
                    booleanOp: "and",
                    terms: [],
                };
                actionGroup.terms.push(term);
            }
        }
        return actionGroup;
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
        searchTerm.term.weight ??= this.defaultTermMatchWeight;
        if (searchTerm.relatedTerms) {
            for (const relatedTerm of searchTerm.relatedTerms) {
                if (!this.validateAndPrepareTerm(relatedTerm)) {
                    return false;
                }
                if (
                    relatedTerm.weight &&
                    relatedTerm.weight >= this.relatedIsExactThreshold
                ) {
                    relatedTerm.weight = this.defaultTermMatchWeight;
                }
            }
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

    private boostEntities(
        searchTerm: SearchTerm,
        sr: SemanticRef,
        scoredRef: ScoredSemanticRef,
        boostWeight: number,
    ): ScoredSemanticRef {
        if (
            sr.knowledgeType === "entity" &&
            q.matchEntityNameOrType(
                searchTerm,
                sr.knowledge as kpLib.ConcreteEntity,
            )
        ) {
            scoredRef = {
                semanticRefIndex: scoredRef.semanticRefIndex,
                score: scoredRef.score * boostWeight,
            };
        }
        return scoredRef;
    }
}

function isPropertyTerm(
    term: SearchTerm | PropertySearchTerm,
): term is PropertySearchTerm {
    return term.hasOwnProperty("propertyName");
}

function isEntityPropertyTerm(term: PropertySearchTerm): boolean {
    switch (term.propertyName) {
        default:
            break;
        case "name":
        case "type":
            return true;
    }
    return false;
}

function isActionPropertyTerm(term: PropertySearchTerm): boolean {
    switch (term.propertyName) {
        default:
            break;
        case "subject":
        case "verb":
        case "object":
        case "indirectObject":
            return true;
    }

    return false;
}

export function getTimeRangeForConversation(
    conversation: IConversation,
): DateRange | undefined {
    const messages = conversation.messages;
    const start = messages[0].timestamp;
    const end = messages[messages.length - 1].timestamp;
    if (start !== undefined) {
        return {
            start: new Date(start),
            end: end ? new Date(end) : undefined,
        };
    }
    return undefined;
}

export function getTimeRangeSectionForConversation(
    conversation: IConversation,
): PromptSection[] {
    const timeRange = getTimeRangeForConversation(conversation);
    if (timeRange) {
        return [
            {
                role: "system",
                content: `ONLY IF user request explicitly asks for time ranges, THEN use the CONVERSATION TIME RANGE: "${timeRange.start} to ${timeRange.end}"`,
            },
        ];
    }
    return [];
}
