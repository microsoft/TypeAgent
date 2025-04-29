// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Result, success } from "typechat";
import {
    IConversation,
    SearchSelectExpr,
    SearchTermGroup,
    WhenFilter,
} from "./interfaces.js";
import {
    ConversationSearchResult,
    runSearchQuery,
    SearchOptions,
    SearchQueryExpr,
} from "./search.js";
import {
    searchQueryFromLanguage,
    SearchQueryTranslator,
} from "./searchQueryTranslator.js";
import * as querySchema from "./searchQuerySchema.js";
import { PropertyTermSet } from "./collections.js";
import { dateRangeFromDateTimeRange } from "./common.js";
import { PropertyNames } from "./propertyIndex.js";
import {
    createOrTermGroup,
    createOrMaxTermGroup,
    createSearchTerm,
    createAndTermGroup,
    createPropertySearchTerm,
} from "./searchLib.js";

/*
    APIs for searching with Natural Language
*/

export async function searchConversationWithLanguage(
    conversation: IConversation,
    searchText: string,
    queryTranslator: SearchQueryTranslator,
    exactScope: boolean = true,
    options?: SearchOptions,
    context?: LanguageSearchContext,
): Promise<Result<ConversationSearchResult[]>> {
    const searchQueryExprResult = await searchQueryExprFromLanguage(
        conversation,
        queryTranslator,
        searchText,
        exactScope,
        context,
    );
    if (!searchQueryExprResult.success) {
        return searchQueryExprResult;
    }
    if (context) {
        context.searchQueryExpr = searchQueryExprResult.data;
    }
    const searchResults: ConversationSearchResult[] = [];
    for (const searchQuery of searchQueryExprResult.data) {
        const queryResult = await runSearchQuery(
            conversation,
            searchQuery,
            options,
        );
        searchResults.push(...queryResult);
    }
    return success(searchResults);
}

/**
 * Functions for compiling natural language queries
 */

export async function searchQueryExprFromLanguage(
    conversation: IConversation,
    translator: SearchQueryTranslator,
    queryText: string,
    exactScope: boolean = true,
    context?: LanguageSearchContext,
): Promise<Result<SearchQueryExpr[]>> {
    const queryResult = await searchQueryFromLanguage(
        conversation,
        translator,
        queryText,
    );
    if (queryResult.success) {
        const searchQuery = queryResult.data;
        if (context) {
            context.searchQuery = searchQuery;
        }
        const searchExpr = compileSearchQuery(
            conversation,
            searchQuery,
            exactScope,
        );
        return success(searchExpr);
    }
    return queryResult;
}

export type LanguageSearchContext = {
    searchQuery?: querySchema.SearchQuery | undefined;
    searchQueryExpr?: SearchQueryExpr[] | undefined;
};

export function compileSearchQuery(
    conversation: IConversation,
    query: querySchema.SearchQuery,
    exactScoping: boolean = true,
): SearchQueryExpr[] {
    const queryBuilder = new SearchQueryCompiler(conversation);
    queryBuilder.exactScoping = exactScoping;
    const searchQueryExprs: SearchQueryExpr[] =
        queryBuilder.compileQuery(query);
    return searchQueryExprs;
}

export function compileSearchFilter(
    conversation: IConversation,
    searchFilter: querySchema.SearchFilter,
    exactScoping: boolean = true,
): SearchSelectExpr {
    const queryBuilder = new SearchQueryCompiler(conversation);
    queryBuilder.exactScoping = exactScoping;
    return queryBuilder.compileSearchFilter(searchFilter);
}
class SearchQueryCompiler {
    private entityTermsAdded: PropertyTermSet;
    private dedupe: boolean = true;
    public queryExpressions: SearchQueryExpr[];
    public exactScoping: boolean = false;

    constructor(public conversation: IConversation) {
        this.queryExpressions = [{ selectExpressions: [] }];
        this.entityTermsAdded = new PropertyTermSet();
    }

    public compileQuery(query: querySchema.SearchQuery): SearchQueryExpr[] {
        // Clone the query so we can modify it
        query = { ...query };
        const queryExpressions: SearchQueryExpr[] = [];
        for (const searchExpr of query.searchExpressions) {
            queryExpressions.push(this.compileSearchExpr(searchExpr));
        }
        return queryExpressions;
    }

    /**
     * Every searchExpr has one or more filters.
     * Each filter is compiled into a selectExpr
     * @param searchExpr
     * @returns
     */
    public compileSearchExpr(
        searchExpr: querySchema.SearchExpr,
    ): SearchQueryExpr {
        const queryExpr: SearchQueryExpr = {
            selectExpressions: [],
        };
        if (searchExpr.filters) {
            for (const filter of searchExpr.filters) {
                queryExpr.selectExpressions.push(
                    this.compileSearchFilter(filter),
                );
            }
        }
        queryExpr.rawQuery = searchExpr.rewrittenQuery;
        return queryExpr;
    }

    public compileSearchFilter(
        filter: querySchema.SearchFilter,
    ): SearchSelectExpr {
        let searchTermGroup = this.compileTermGroup(filter);
        let when = this.compileWhen(filter);
        return {
            searchTermGroup,
            when,
        };
    }

    private compileTermGroup(
        filter: querySchema.SearchFilter,
    ): SearchTermGroup {
        const termGroup = createOrTermGroup();
        this.entityTermsAdded.clear();
        if (isEntityTermArray(filter.entitySearchTerms)) {
            this.compileEntityTerms(filter.entitySearchTerms, termGroup);
        }
        if (filter.actionSearchTerm) {
            termGroup.terms.push(
                this.compileActionTerm(filter.actionSearchTerm, false),
            );
            this.compileActionTermAsSearchTerms(
                filter.actionSearchTerm,
                termGroup,
            );
        }
        if (filter.searchTerms) {
            this.compileSearchTerms(filter.searchTerms, termGroup);
        }
        return termGroup;
    }

    private compileWhen(filter: querySchema.SearchFilter) {
        this.entityTermsAdded.clear();

        let when: WhenFilter | undefined;
        const actionTerm = filter.actionSearchTerm;
        if (actionTerm) {
            const scopeDefiningTerms = this.compileScope(actionTerm);
            if (scopeDefiningTerms.terms.length > 0) {
                when ??= {};
                when.scopeDefiningTerms = scopeDefiningTerms;
            }
        }
        if (filter.timeRange) {
            when ??= {};
            when.dateRange = dateRangeFromDateTimeRange(filter.timeRange);
        }
        return when;
    }

    public compileActionTermAsSearchTerms(
        actionTerm: querySchema.ActionTerm,
        termGroup?: SearchTermGroup,
        useOrMax: boolean = true,
    ): SearchTermGroup {
        termGroup ??= createOrTermGroup();
        const actionGroup = useOrMax ? createOrMaxTermGroup() : termGroup;
        if (actionTerm.actionVerbs !== undefined) {
            this.compileSearchTerms(actionTerm.actionVerbs.words, actionGroup);
        }
        if (isEntityTermArray(actionTerm.actorEntities)) {
            this.compileEntityTerms(actionTerm.actorEntities, actionGroup);
        }
        if (isEntityTermArray(actionTerm.targetEntities)) {
            this.compileEntityTerms(actionTerm.targetEntities, actionGroup);
        }
        if (isEntityTermArray(actionTerm.additionalEntities)) {
            this.compileEntityTerms(actionTerm.additionalEntities, actionGroup);
        }
        if (actionGroup !== termGroup) {
            termGroup.terms.push(actionGroup);
        }
        return termGroup;
    }

    private compileSearchTerms(
        searchTerms: string[],
        termGroup?: SearchTermGroup,
    ): SearchTermGroup {
        termGroup ??= createOrTermGroup();
        for (const searchTerm of searchTerms) {
            termGroup.terms.push(createSearchTerm(searchTerm));
        }
        return termGroup;
    }

    private compileEntityTerms(
        entityTerms: querySchema.EntityTerm[],
        termGroup: SearchTermGroup,
        useOrMax: boolean = true,
    ): void {
        if (useOrMax) {
            const dedupe = this.dedupe;
            this.dedupe = false;
            for (const term of entityTerms) {
                const orMax = createOrMaxTermGroup();
                this.addEntityTermToGroup(term, orMax);
                termGroup.terms.push(optimizeOrMax(orMax));
            }
            this.dedupe = dedupe;
        } else {
            for (const term of entityTerms) {
                this.addEntityTermToGroup(term, termGroup);
            }
        }
    }

    private compileScope(
        actionTerm: querySchema.ActionTerm,
        includeAdditional: boolean = true,
    ): SearchTermGroup {
        const dedupe = this.dedupe;
        this.dedupe = false;

        let termGroup = this.compileActionTerm(actionTerm, true);
        if (
            includeAdditional &&
            isEntityTermArray(actionTerm.additionalEntities)
        ) {
            this.addEntityNamesToGroup(
                actionTerm.additionalEntities,
                PropertyNames.EntityName,
                termGroup,
                this.exactScoping,
            );
        }

        this.dedupe = dedupe;
        return termGroup;
    }

    private compileActionTerm(
        actionTerm: querySchema.ActionTerm,
        useAnd: boolean,
    ) {
        const dedupe = this.dedupe;
        this.dedupe = false;
        let termGroup: SearchTermGroup;
        if (isEntityTermArray(actionTerm.targetEntities)) {
            termGroup = useAnd ? createAndTermGroup() : createOrTermGroup();
            for (const entity of actionTerm.targetEntities) {
                const svo = this.compileSubjectVerb(actionTerm);
                // A target can be the name of an object of an action OR the name of an entity
                svo.terms.push(this.compileObjectOrEntityName(entity));
                termGroup.terms.push(svo);
            }
            if (termGroup.terms.length === 1) {
                termGroup = termGroup.terms[0] as SearchTermGroup;
            }
        } else {
            termGroup = this.compileSubjectVerb(actionTerm);
        }

        this.dedupe = dedupe;
        return termGroup;
    }

    private compileSubjectVerb(
        actionTerm: querySchema.ActionTerm,
    ): SearchTermGroup {
        const termGroup = createAndTermGroup();
        if (isEntityTermArray(actionTerm.actorEntities)) {
            this.addEntityNamesToGroup(
                actionTerm.actorEntities,
                PropertyNames.Subject,
                termGroup,
            );
        }

        if (actionTerm.actionVerbs !== undefined) {
            this.addVerbsToGroup(actionTerm.actionVerbs, termGroup);
        }
        return termGroup;
    }

    private compileObjectOrEntityName(
        entity: querySchema.EntityTerm,
    ): SearchTermGroup {
        // A target can be the name of an object of an action OR the name of an entity
        const objectTermGroup = createOrTermGroup();
        this.addEntityNameToGroup(
            entity,
            PropertyNames.Object,
            objectTermGroup,
        );
        this.addEntityNameToGroup(
            entity,
            PropertyNames.EntityName,
            objectTermGroup,
            this.exactScoping,
        );
        return objectTermGroup;
    }

    private addVerbsToGroup(
        verbs: querySchema.VerbsTerm,
        termGroup: SearchTermGroup,
    ) {
        for (const verb of verbs.words) {
            this.addPropertyTermToGroup(PropertyNames.Verb, verb, termGroup);
        }
    }

    private addEntityTermToGroup(
        entityTerm: querySchema.EntityTerm,
        termGroup: SearchTermGroup,
        exactMatchName: boolean = false,
    ): void {
        this.addPropertyTermToGroup(
            PropertyNames.EntityName,
            entityTerm.name,
            termGroup,
            exactMatchName,
        );
        if (entityTerm.type && entityTerm.type.length > 0) {
            for (const type of entityTerm.type) {
                this.addPropertyTermToGroup(
                    PropertyNames.EntityType,
                    type,
                    termGroup,
                );
            }
        }
        if (entityTerm.facets && entityTerm.facets.length > 0) {
            for (const facetTerm of entityTerm.facets) {
                const nameWildcard = isWildcard(facetTerm.facetName);
                const valueWildcard = isWildcard(facetTerm.facetValue);
                if (!(nameWildcard || valueWildcard)) {
                    this.addPropertyTermToGroup(
                        facetTerm.facetName,
                        facetTerm.facetValue,
                        termGroup,
                    );
                } else if (nameWildcard) {
                    this.addPropertyTermToGroup(
                        PropertyNames.FacetValue,
                        facetTerm.facetValue,
                        termGroup,
                    );
                } else if (valueWildcard) {
                    this.addPropertyTermToGroup(
                        PropertyNames.FacetName,
                        facetTerm.facetName,
                        termGroup,
                    );
                }
            }
        }
    }

    private addEntityNamesToGroup(
        entityTerms: querySchema.EntityTerm[],
        propertyName: PropertyNames,
        termGroup: SearchTermGroup,
        exactMatchValue: boolean = false,
    ): void {
        for (const entityTerm of entityTerms) {
            this.addEntityNameToGroup(
                entityTerm,
                propertyName,
                termGroup,
                exactMatchValue,
            );
        }
    }

    private addEntityNameToGroup(
        entityTerm: querySchema.EntityTerm,
        propertyName: PropertyNames,
        termGroup: SearchTermGroup,
        exactMatchValue: boolean = false,
    ): void {
        if (!entityTerm.isNamePronoun) {
            this.addPropertyTermToGroup(
                propertyName,
                entityTerm.name,
                termGroup,
                exactMatchValue,
            );
        }
    }

    private addPropertyTermToGroup(
        propertyName: string,
        propertyValue: string,
        termGroup: SearchTermGroup,
        exactMatchValue: boolean = false,
    ): void {
        if (
            !this.isSearchableString(propertyName) ||
            !this.isSearchableString(propertyValue) ||
            this.isNoiseTerm(propertyValue)
        ) {
            return;
        }
        // Dedupe any terms already added to the group earlier
        if (
            !this.dedupe ||
            !this.entityTermsAdded.has(propertyName, propertyValue)
        ) {
            const searchTerm = createPropertySearchTerm(
                propertyName,
                propertyValue,
                exactMatchValue,
            );
            termGroup.terms.push(searchTerm);
            this.entityTermsAdded.add(
                propertyName,
                searchTerm.propertyValue.term,
            );
        }
    }

    private isSearchableString(value: string): boolean {
        return !(isEmptyString(value) || isWildcard(value));
    }

    private isNoiseTerm(value: string): boolean {
        // TODO: move hardcoded to a user configurable table
        switch (value.toLowerCase()) {
            default:
                return false;
            case "thing":
            case "object":
            case "concept":
            case "idea":
            case "entity":
                return true;
        }
    }
}

const Wildcard = "*";

function isEntityTermArray(
    terms: querySchema.EntityTerm[] | "*" | undefined,
): terms is querySchema.EntityTerm[] {
    if (terms !== undefined) {
        if (Array.isArray(terms)) {
            return true;
        } else if (typeof terms === "string") {
            return terms !== Wildcard;
        }
    }
    return false;
}

function isWildcard(value: string | undefined): boolean {
    return value !== undefined && value === Wildcard;
}

function isEmptyString(value: string): boolean {
    return value === undefined || value.length === 0;
}

function optimizeOrMax(termGroup: SearchTermGroup) {
    if (termGroup.terms.length === 1) {
        return termGroup.terms[0];
    }
    return termGroup;
}
