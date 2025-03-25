// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createJsonTranslator,
    Result,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
} from "typechat";
import * as querySchema from "./searchQuerySchema.js";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { loadSchema } from "typeagent";
import {
    createPropertySearchTerm,
    createSearchTerm,
    SearchTermGroup,
    dateRangeFromDateTimeRange,
    WhenFilter,
} from "./search.js";
import { /*isKnownProperty,*/ PropertyNames } from "./propertyIndex.js";
import { PropertyTermSet } from "./collections.js";
import { IConversation } from "./interfaces.js";
import { getTimeRangePromptSectionForConversation } from "./conversation.js";
import { createAndTermGroup, createOrTermGroup } from "./common.js";

/*-------------------------------

    EXPERIMENTAL CODE
    Frequent changes

---------------------------------*/

export type SearchQueryTranslator =
    TypeChatJsonTranslator<querySchema.SearchQuery>;

export function createSearchQueryTranslator(
    model: TypeChatLanguageModel,
): SearchQueryTranslator {
    const typeName = "SearchQuery";
    const searchActionSchema = loadSchema(
        ["dateTimeSchema.ts", "searchQuerySchema.ts"],
        import.meta.url,
    );

    return createJsonTranslator<querySchema.SearchQuery>(
        model,
        createTypeScriptJsonValidator<querySchema.SearchQuery>(
            searchActionSchema,
            typeName,
        ),
    );
}

export type SearchSelectExpr = {
    searchTermGroup: SearchTermGroup;
    when?: WhenFilter | undefined;
};

export type SearchQueryExpr = {
    selectExpressions: SearchSelectExpr[];
    rawQuery?: string | undefined;
};

export async function createSearchQueryForConversation(
    conversation: IConversation,
    queryTranslator: SearchQueryTranslator,
    text: string,
): Promise<Result<querySchema.SearchQuery>> {
    const result = await queryTranslator.translate(
        text,
        getTimeRangePromptSectionForConversation(conversation),
    );
    return result;
}

export function compileSearchQueryForConversation(
    conversation: IConversation,
    query: querySchema.SearchQuery,
    exactScoping: boolean = true,
): SearchQueryExpr[] {
    const queryBuilder = new SearchQueryExprBuilder(conversation, exactScoping);
    const searchQueryExprs: SearchQueryExpr[] =
        queryBuilder.compileQuery(query);
    return searchQueryExprs;
}

export class SearchQueryExprBuilder {
    private entityTermsAdded: PropertyTermSet;
    public queryExpressions: SearchQueryExpr[];
    private scopingEntityTerms: querySchema.EntityTerm[];

    constructor(
        public conversation: IConversation,
        public exactScoping: boolean = false,
    ) {
        this.queryExpressions = [{ selectExpressions: [] }];
        this.entityTermsAdded = new PropertyTermSet();
        this.scopingEntityTerms = [];
    }

    public compileQuery(query: querySchema.SearchQuery): SearchQueryExpr[] {
        const queryExpressions: SearchQueryExpr[] = [];
        for (const searchExpr of query.searchExpressions) {
            queryExpressions.push(this.compileSearchExpr(searchExpr));
        }
        return queryExpressions;
    }

    private compileSearchExpr(expr: querySchema.SearchExpr): SearchQueryExpr {
        const queryExpr: SearchQueryExpr = {
            selectExpressions: [],
        };
        if (expr.filters) {
            for (const filter of expr.filters) {
                queryExpr.selectExpressions.push(
                    this.compileFilterExpr(filter),
                );
            }
        }
        queryExpr.rawQuery = expr.rewrittenQuery;
        return queryExpr;
    }

    private compileFilterExpr(
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
        if (filter.entitySearchTerms) {
            termGroup.terms.push(
                ...this.compileEntityTerms(filter.entitySearchTerms),
            );
        }
        if (filter.actionSearchTerm) {
            this.addActionTermsToGroup(filter.actionSearchTerm, termGroup);
        }
        if (filter.searchTerms) {
            this.addSearchTermsToGroup(filter.searchTerms, termGroup);
        }
        return termGroup;
    }

    private compileWhen(filter: querySchema.SearchFilter) {
        let when: WhenFilter | undefined;
        if (filter.actionSearchTerm) {
            if (
                isEntityTermArray(filter.actionSearchTerm.additionalEntities) &&
                filter.actionSearchTerm.additionalEntities.length > 0
            ) {
                this.scopingEntityTerms.push(
                    ...filter.actionSearchTerm.additionalEntities,
                );
            }
        }
        if (this.scopingEntityTerms.length > 0) {
            when ??= {};
            when.scopeDefiningTerms = createAndTermGroup();
            this.entityTermsAdded.clear();
            this.addScopingTermsToGroup(
                this.scopingEntityTerms,
                when.scopeDefiningTerms,
            );
        }
        if (filter.timeRange) {
            when ??= {};
            when.dateRange = dateRangeFromDateTimeRange(filter.timeRange);
        }
        return when;
    }

    private compileVerbTerms(
        actionVerbs: querySchema.VerbsTerm,
    ): SearchTermGroup {
        const verbTermGroup = createOrTermGroup();
        for (const verb of actionVerbs.words) {
            this.addPropertyTermToGroup(
                PropertyNames.Verb,
                verb,
                verbTermGroup,
            );
        }
        this.addSearchTermsToGroup([...actionVerbs.words], verbTermGroup);
        return verbTermGroup;
    }

    private compileEntityTerm(
        entityTerm: querySchema.EntityTerm,
    ): SearchTermGroup {
        const entityTermGroup = createAndTermGroup();
        this.addEntityTermToGroup(entityTerm, entityTermGroup);
        return entityTermGroup;
    }

    private compileEntityTerms(
        entityTerms: querySchema.EntityTerm[],
    ): SearchTermGroup[] {
        return entityTerms.map((et) => this.compileEntityTerm(et));
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
        if (entityTerm.type) {
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
                if (!(nameWildcard && valueWildcard)) {
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

    private addActionTermsToGroup(
        actionTerm: querySchema.ActionTerm,
        termGroup: SearchTermGroup,
    ): void {
        if (actionTerm.actionVerbs) {
            const verbTerms = this.compileVerbTerms(actionTerm.actionVerbs);
            termGroup.terms.push(verbTerms);
        }
        if (isEntityTermArray(actionTerm.actorEntities)) {
            this.addEntityNamesToGroup(
                actionTerm.actorEntities,
                PropertyNames.Subject,
                termGroup,
            );
        }
        if (isEntityTermArray(actionTerm.targetEntities)) {
            const hasAdditionalEntities = isEntityTermArray(
                actionTerm.additionalEntities,
            );
            if (hasAdditionalEntities) {
                // If additional entities, then assume the targetEntities represent an Object in an action
                this.addEntityNamesToGroup(
                    actionTerm.targetEntities,
                    PropertyNames.Object,
                    termGroup,
                );
            } else {
                // Use entity terms lookup to apply scopes
                this.scopingEntityTerms.push(...actionTerm.targetEntities);
                termGroup.terms.push(
                    ...this.compileEntityTerms(actionTerm.targetEntities),
                );
            }

            if (isEntityTermArray(actionTerm.additionalEntities)) {
                termGroup.terms.push(
                    ...this.compileEntityTerms(actionTerm.additionalEntities),
                );
            }
        }
    }

    private addScopingTermsToGroup(
        entityTerms: querySchema.EntityTerm[],
        termGroup: SearchTermGroup,
    ): void {
        for (const entityTerm of entityTerms) {
            // TODO: handle pronouns
            if (!entityTerm.isNamePronoun) {
                this.addEntityTermToGroup(
                    entityTerm,
                    termGroup,
                    this.exactScoping /* true => exact match name */,
                );
            }
        }
    }

    private addEntityNamesToGroup(
        entityTerms: querySchema.EntityTerm[],
        propertyName: PropertyNames,
        termGroup: SearchTermGroup,
    ): void {
        for (const entityTerm of entityTerms) {
            this.addPropertyTermToGroup(
                propertyName,
                entityTerm.name,
                termGroup,
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
        if (!this.entityTermsAdded.has(propertyName, propertyValue)) {
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

    private addSearchTermsToGroup(
        searchTerms: string[],
        termGroup: SearchTermGroup,
    ): void {
        for (const searchTerm of searchTerms) {
            termGroup.terms.push(createSearchTerm(searchTerm));
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
                return true;
        }
    }
    /*
    private doesPropertyExist(
        propertyName: PropertyNames,
        propertyValue: string,
    ): boolean {
        const propertyIndex =
            this.conversation.secondaryIndexes?.propertyToSemanticRefIndex;
        if (!propertyIndex) {
            return false;
        }
        if (isKnownProperty(propertyIndex, propertyName, propertyValue)) {
            return true;
        }
        const aliasIndex =
            this.conversation.secondaryIndexes?.termToRelatedTermsIndex
                ?.aliases;
        if (aliasIndex) {
            const propertyAliases = aliasIndex.lookupTerm(propertyValue);
            if (propertyAliases && propertyAliases.length > 0) {
                for (const alias of propertyAliases) {
                    if (
                        isKnownProperty(propertyIndex, propertyName, alias.text)
                    ) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
        */
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
