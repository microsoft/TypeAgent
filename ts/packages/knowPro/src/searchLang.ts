// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection, Result, success } from "typechat";
import {
    IConversation,
    SearchSelectExpr,
    SearchTermGroup,
    WhenFilter,
} from "./interfaces.js";
import {
    ConversationSearchResult,
    createSearchOptions,
    hasConversationResults,
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
import {
    getCountOfMessagesInCharBudget,
    getMessageOrdinalsFromScored,
} from "./message.js";

/*
    APIs for searching with Natural Language
    Work in progress; frequent improvements/tweaks
*/

export async function searchConversationWithLanguage(
    conversation: IConversation,
    searchText: string,
    queryTranslator: SearchQueryTranslator,
    options?: LanguageSearchOptions,
    context?: LanguageSearchDebugContext,
): Promise<Result<ConversationSearchResult[]>> {
    options ??= createLanguageSearchOptions();
    const langQueryResult = await searchQueryExprFromLanguage(
        conversation,
        queryTranslator,
        searchText,
        options,
        context,
    );
    if (!langQueryResult.success) {
        return langQueryResult;
    }
    const searchQueryExprs = langQueryResult.data.queryExpressions;
    if (context) {
        context.searchQueryExpr = searchQueryExprs;
    }
    let fallbackQueryExpr = compileFallbackQuery(
        langQueryResult.data.query,
        options.compileOptions,
    );

    const searchResults: ConversationSearchResult[] = [];
    for (let i = 0; i < searchQueryExprs.length; ++i) {
        const searchQuery = searchQueryExprs[i];
        let queryResult = await runSearchQuery(
            conversation,
            searchQuery,
            options,
        );
        if (!hasConversationResults(queryResult) && fallbackQueryExpr) {
            // Rerun the query but with verb matching turned off for scopes
            queryResult = await runSearchQuery(
                conversation,
                fallbackQueryExpr[i],
                options,
            );
        }
        //
        // If no matches and classic RAG fallback enabled
        //
        if (
            !hasConversationResults(queryResult) &&
            searchQuery.rawQuery &&
            options?.fallbackRagOptions
        ) {
            const ragMatches = await searchConversationRag(
                conversation,
                searchQuery.rawQuery,
                options.fallbackRagOptions,
            );
            if (ragMatches) {
                searchResults.push(ragMatches);
            }
        } else {
            searchResults.push(...queryResult);
        }
    }
    return success(searchResults);

    function compileFallbackQuery(
        query: querySchema.SearchQuery,
        compileOptions: LanguageQueryCompileOptions,
    ): SearchQueryExpr[] | undefined {
        const verbScope = compileOptions.verbScope;
        if (
            !compileOptions.exactScope &&
            (verbScope == undefined || verbScope)
        ) {
            return compileSearchQuery(conversation, query, {
                ...compileOptions,
                verbScope: false,
            });
        }
        return undefined;
    }
}

export type LanguageQueryExpr = {
    queryText: string;
    query: querySchema.SearchQuery;
    queryExpressions: SearchQueryExpr[];
};

/**
 * Functions for compiling natural language queries
 */
export async function searchQueryExprFromLanguage(
    conversation: IConversation,
    translator: SearchQueryTranslator,
    queryText: string,
    options?: LanguageSearchOptions,
    debugContext?: LanguageSearchDebugContext,
): Promise<Result<LanguageQueryExpr>> {
    const queryResult = await searchQueryFromLanguage(
        conversation,
        translator,
        queryText,
        options?.modelInstructions,
    );
    if (queryResult.success) {
        const query = queryResult.data;
        if (debugContext) {
            debugContext.searchQuery = query;
        }
        options ??= createLanguageSearchOptions();
        const queryExpressions = compileSearchQuery(
            conversation,
            query,
            options.compileOptions,
        );
        return success({
            queryText,
            query,
            queryExpressions,
        });
    }
    return queryResult;
}

export type LanguageQueryCompileOptions = {
    /**
     * Is fuzzy matching enabled when applying scope?
     */
    exactScope?: boolean | undefined;
    verbScope?: boolean | undefined;
    // Use to ignore noise terms etc.
    termFilter?: (text: string) => boolean;
    // Debug flags
    applyScope?: boolean | undefined; // Turn off scope matching entirely
};

export function createLanguageQueryCompileOptions(): LanguageQueryCompileOptions {
    return { applyScope: true, exactScope: false, verbScope: true };
}

export interface LanguageSearchOptions extends SearchOptions {
    compileOptions: LanguageQueryCompileOptions;
    fallbackRagOptions?: LanguageSearchRagOptions | undefined;
    modelInstructions?: PromptSection[] | undefined;
}

export function createLanguageSearchOptions(): LanguageSearchOptions {
    return {
        ...createSearchOptions(),
        compileOptions: createLanguageQueryCompileOptions(),
    };
}

export type LanguageSearchDebugContext = {
    /**
     * Query returned by the LLM
     */
    searchQuery?: querySchema.SearchQuery | undefined;
    /**
     * What searchQuery was compiled into
     */
    searchQueryExpr?: SearchQueryExpr[] | undefined;
};

export function compileSearchQuery(
    conversation: IConversation,
    query: querySchema.SearchQuery,
    options?: LanguageQueryCompileOptions,
): SearchQueryExpr[] {
    const queryBuilder = new SearchQueryCompiler(conversation, options);
    const searchQueryExprs: SearchQueryExpr[] =
        queryBuilder.compileQuery(query);
    return searchQueryExprs;
}

export function compileSearchFilter(
    conversation: IConversation,
    searchFilter: querySchema.SearchFilter,
    options?: LanguageQueryCompileOptions,
): SearchSelectExpr {
    const queryBuilder = new SearchQueryCompiler(
        conversation,
        options ?? createLanguageQueryCompileOptions(),
    );
    return queryBuilder.compileSearchFilter(searchFilter);
}

export async function searchConversationRag(
    conversation: IConversation,
    searchText: string,
    options: LanguageSearchRagOptions,
): Promise<ConversationSearchResult | undefined> {
    const messageIndex = conversation.secondaryIndexes?.messageIndex;
    if (!messageIndex) {
        return undefined;
    }
    let messageMatches = await messageIndex.lookupMessages(
        searchText,
        options.maxMessageMatches,
        options.thresholdScore,
    );
    if (messageMatches.length === 0) {
        return undefined;
    }
    if (options.maxCharsInBudget && options.maxCharsInBudget > 0) {
        const messageCountInBudget = getCountOfMessagesInCharBudget(
            conversation.messages,
            getMessageOrdinalsFromScored(conversation.messages, messageMatches),
            options.maxCharsInBudget,
        );
        messageMatches = messageMatches.slice(0, messageCountInBudget);
    }
    return {
        messageMatches,
        knowledgeMatches: new Map(),
    };
}

export type LanguageSearchRagOptions = {
    maxMessageMatches?: number | undefined;
    thresholdScore?: number | undefined;
    maxCharsInBudget?: number | undefined;
};

class SearchQueryCompiler {
    private entityTermsAdded: PropertyTermSet;
    private dedupe: boolean = true;

    public queryExpressions: SearchQueryExpr[];
    public compileOptions: LanguageQueryCompileOptions;

    constructor(
        public conversation: IConversation,
        compileOptions?: LanguageQueryCompileOptions,
    ) {
        this.compileOptions =
            compileOptions ?? createLanguageQueryCompileOptions();
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
            /*
            termGroup.terms.push(
                this.compileActionTerm(filter.actionSearchTerm, false, true),
            );
            */
            this.compileActionTermAsSearchTerms(
                filter.actionSearchTerm,
                termGroup,
                false,
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
        if (
            this.compileOptions.applyScope &&
            actionTerm &&
            this.shouldAddScope(actionTerm)
        ) {
            const scopeDefiningTerms = this.compileScope(
                actionTerm,
                true,
                this.compileOptions.verbScope ?? true,
            );
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
            for (const verb of actionTerm.actionVerbs.words) {
                this.addPropertyTermToGroup(
                    PropertyNames.Topic,
                    verb,
                    actionGroup,
                );
            }
        }
        if (isEntityTermArray(actionTerm.actorEntities)) {
            this.compileEntityTermsAsSearchTerms(
                actionTerm.actorEntities,
                actionGroup,
            );
        }
        if (isEntityTermArray(actionTerm.targetEntities)) {
            this.compileEntityTermsAsSearchTerms(
                actionTerm.targetEntities,
                actionGroup,
            );
        }
        if (isEntityTermArray(actionTerm.additionalEntities)) {
            this.compileEntityTermsAsSearchTerms(
                actionTerm.additionalEntities,
                actionGroup,
            );
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
        // Also search for topics
        for (const term of entityTerms) {
            this.addEntityNameToGroup(term, PropertyNames.Topic, termGroup);
            if (term.facets) {
                for (const facet of term.facets) {
                    if (!isWildcard(facet.facetValue)) {
                        this.addPropertyTermToGroup(
                            facet.facetValue,
                            PropertyNames.Topic,
                            termGroup,
                        );
                    }
                }
            }
        }
    }

    private compileEntityTermsAsSearchTerms(
        entityTerms: querySchema.EntityTerm[],
        termGroup: SearchTermGroup,
    ): void {
        for (const term of entityTerms) {
            this.addEntityTermAsSearchTermsToGroup(term, termGroup);
        }
    }

    private compileScope(
        actionTerm: querySchema.ActionTerm,
        includeAdditionalEntities: boolean = true,
        includeVerbs: boolean = true,
    ): SearchTermGroup {
        const dedupe = this.dedupe;
        this.dedupe = false;

        let termGroup = this.compileActionTerm(actionTerm, true, includeVerbs);
        if (
            includeAdditionalEntities &&
            isEntityTermArray(actionTerm.additionalEntities)
        ) {
            this.addEntityNamesToGroup(
                actionTerm.additionalEntities,
                PropertyNames.EntityName,
                termGroup,
                this.compileOptions.exactScope,
            );
        }

        this.dedupe = dedupe;
        return termGroup;
    }

    private compileActionTerm(
        actionTerm: querySchema.ActionTerm,
        useAnd: boolean,
        includeVerbs: boolean,
    ) {
        const dedupe = this.dedupe;
        this.dedupe = false;
        let termGroup: SearchTermGroup;
        if (isEntityTermArray(actionTerm.targetEntities)) {
            termGroup = useAnd ? createAndTermGroup() : createOrTermGroup();
            for (const entity of actionTerm.targetEntities) {
                const svoTermGroup = includeVerbs
                    ? this.compileSubjectAndVerb(actionTerm)
                    : this.compileSubject(actionTerm);
                // A target can be the name of an object of an action OR the name of an entity
                const objectTermGroup = this.compileObject(entity);
                if (objectTermGroup.terms.length > 0) {
                    svoTermGroup.terms.push(objectTermGroup);
                }
                termGroup.terms.push(svoTermGroup);
            }
            if (termGroup.terms.length === 1) {
                termGroup = termGroup.terms[0] as SearchTermGroup;
            }
        } else {
            termGroup = this.compileSubjectAndVerb(actionTerm);
        }

        this.dedupe = dedupe;
        return termGroup;
    }

    private compileSubjectAndVerb(
        actionTerm: querySchema.ActionTerm,
    ): SearchTermGroup {
        const termGroup = createAndTermGroup();
        this.addSubjectToGroup(actionTerm, termGroup);
        if (actionTerm.actionVerbs !== undefined) {
            this.addVerbsToGroup(actionTerm.actionVerbs, termGroup);
        }
        return termGroup;
    }

    private compileSubject(
        actionTerm: querySchema.ActionTerm,
    ): SearchTermGroup {
        const termGroup = createAndTermGroup();
        this.addSubjectToGroup(actionTerm, termGroup);
        return termGroup;
    }

    private addSubjectToGroup(
        actionTerm: querySchema.ActionTerm,
        termGroup: SearchTermGroup,
    ): void {
        if (isEntityTermArray(actionTerm.actorEntities)) {
            this.addEntityNamesToGroup(
                actionTerm.actorEntities,
                PropertyNames.Subject,
                termGroup,
            );
        }
    }

    private compileObject(entity: querySchema.EntityTerm): SearchTermGroup {
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
            this.compileOptions.exactScope,
        );
        this.addEntityNameToGroup(
            entity,
            PropertyNames.Topic,
            objectTermGroup,
            this.compileOptions.exactScope,
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

    private addEntityTermAsSearchTermsToGroup(
        entityTerm: querySchema.EntityTerm,
        termGroup: SearchTermGroup,
    ): void {
        if (entityTerm.isNamePronoun) {
            return;
        }
        termGroup.terms.push(createSearchTerm(entityTerm.name));
        if (entityTerm.facets && entityTerm.facets.length > 0) {
            for (const facetTerm of entityTerm.facets) {
                const valueWildcard = isWildcard(facetTerm.facetValue);
                if (!valueWildcard) {
                    termGroup.terms.push(
                        createSearchTerm(facetTerm.facetValue),
                    );
                }
            }
        }
    }

    private isSearchableString(value: string): boolean {
        let isSearchable = !(isEmptyString(value) || isWildcard(value));
        if (isSearchable && this.compileOptions.termFilter) {
            isSearchable = this.compileOptions.termFilter(value);
        }
        return isSearchable;
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

    private shouldAddScope(actionTerm: querySchema.ActionTerm): boolean {
        if (!actionTerm || actionTerm.isInformational) {
            return false;
        }
        if (this.compileOptions.exactScope) {
            return true;
        }
        // If the action has no subject, disable scope
        // isEntityTermArray checks for wildcards etc
        return isEntityTermArray(actionTerm.actorEntities);
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
