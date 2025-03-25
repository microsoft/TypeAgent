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

export function createSearchSelectExpr(): SearchSelectExpr {
    return {
        searchTermGroup: { booleanOp: "or", terms: [] },
    };
}

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
        public exactScoping: boolean = true,
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
        const termGroup: SearchTermGroup = { booleanOp: "or", terms: [] };
        this.entityTermsAdded.clear();
        if (filter.entitySearchTerms) {
            this.addEntityTermsToGroup(filter.entitySearchTerms, termGroup);
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
            when.scopeDefiningTerms = { booleanOp: "and", terms: [] };
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

    private addEntityTermsToGroup(
        entityTerms: querySchema.EntityTerm[],
        termGroup: SearchTermGroup,
        exactMatchName: boolean = false,
    ): void {
        if (entityTerms && entityTerms.length > 0) {
            for (const entityTerm of entityTerms) {
                this.addEntityTermToGroup(
                    entityTerm,
                    termGroup,
                    exactMatchName,
                );
            }
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
            for (const verb of actionTerm.actionVerbs.words) {
                this.addPropertyTermToGroup(
                    PropertyNames.Verb,
                    verb,
                    termGroup,
                );
            }
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
                /*
                const objectGroup: SearchTermGroup = {
                    booleanOp: "or",
                    terms: [],
                };
                this.addEntityNamesToGroup(
                    actionTerm.targetEntities,
                    PropertyNames.Object,
                    objectGroup,
                );
                this.addEntityNamesToGroup(
                    actionTerm.targetEntities,
                    PropertyNames.IndirectObject,
                    objectGroup,
                );
                termGroup.terms.push(objectGroup);
                */
            } else {
                // Use entity terms lookup to apply scopes
                this.scopingEntityTerms.push(...actionTerm.targetEntities);
                this.addEntityTermsToGroup(
                    actionTerm.targetEntities,
                    termGroup,
                );
            }

            if (isEntityTermArray(actionTerm.additionalEntities)) {
                this.addEntityTermsToGroup(
                    actionTerm.additionalEntities,
                    termGroup,
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
