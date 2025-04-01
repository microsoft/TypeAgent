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
    dateRangeFromDateTimeRange,
    WhenFilter,
} from "./search.js";
import { SearchTermGroup } from "./interfaces.js";
import { /*isKnownProperty,*/ PropertyNames } from "./propertyIndex.js";
import { PropertyTermSet } from "./collections.js";
import { IConversation } from "./interfaces.js";
import { getTimeRangePromptSectionForConversation } from "./conversation.js";
import {
    createAndTermGroup,
    createOrMaxTermGroup,
    createOrTermGroup,
} from "./common.js";

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
    const queryBuilder = new SearchQueryExprBuilder(conversation);
    queryBuilder.exactScoping = exactScoping;
    const searchQueryExprs: SearchQueryExpr[] =
        queryBuilder.compileQuery(query);
    return searchQueryExprs;
}

export class SearchQueryExprBuilder {
    private entityTermsAdded: PropertyTermSet;
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
        if (isEntityTermArray(filter.entitySearchTerms)) {
            this.compileEntityTerms(filter.entitySearchTerms, termGroup);
        }
        if (filter.actionSearchTerm) {
            this.compileActionTerm(filter.actionSearchTerm, termGroup);
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
        let scopeDefiningTerms = createAndTermGroup();

        const actionTerm = filter.actionSearchTerm;
        if (actionTerm) {
            if (
                actionTerm.targetEntities &&
                !this.shouldTreatTargetsAsObjects(actionTerm)
            ) {
                // The entity term is not already an Object match
                this.addScopingTermsToGroup(
                    actionTerm.targetEntities,
                    scopeDefiningTerms,
                );
            }
            let additionalEntities =
                filter.actionSearchTerm?.additionalEntities;
            if (
                isEntityTermArray(additionalEntities) &&
                additionalEntities.length > 0
            ) {
                this.addScopingTermsToGroup(
                    additionalEntities,
                    scopeDefiningTerms,
                );
            }
        }
        if (scopeDefiningTerms.terms.length > 0) {
            when ??= {};
            when.scopeDefiningTerms = scopeDefiningTerms;
        }
        if (filter.timeRange) {
            when ??= {};
            when.dateRange = dateRangeFromDateTimeRange(filter.timeRange);
        }
        return when;
    }

    private compileActionTerm(
        actionTerm: querySchema.ActionTerm,
        termGroup?: SearchTermGroup,
    ): SearchTermGroup {
        termGroup ??= createAndTermGroup();
        if (actionTerm.actionVerbs !== undefined) {
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
        if (actionTerm.targetEntities) {
            if (this.shouldTreatTargetsAsObjects(actionTerm)) {
                // If additional entities, then for now, assume the targetEntities represent an Object in an action
                this.addEntityNamesToGroup(
                    actionTerm.targetEntities,
                    PropertyNames.Object,
                    termGroup,
                );
            } else {
                let objects = this.extractObjects(actionTerm.targetEntities);
                if (objects.length > 0) {
                    this.addEntityNamesToGroup(
                        objects,
                        PropertyNames.Object,
                        termGroup,
                    );
                }
            }
        }
        return termGroup;
    }

    private compileActionTermAsSearchTerms(
        actionTerm: querySchema.ActionTerm,
        termGroup?: SearchTermGroup,
    ): SearchTermGroup {
        termGroup ??= createAndTermGroup();
        if (actionTerm.actionVerbs !== undefined) {
            this.compileSearchTerms(actionTerm.actionVerbs.words, termGroup);
        }
        if (
            actionTerm.targetEntities &&
            !this.shouldTreatTargetsAsObjects(actionTerm)
        ) {
            this.compileEntityTerms(actionTerm.targetEntities, termGroup);
        }
        if (isEntityTermArray(actionTerm.additionalEntities)) {
            this.compileEntityTerms(actionTerm.additionalEntities, termGroup);
        }
        return termGroup;
    }

    private shouldTreatTargetsAsObjects(
        actionTerm: querySchema.ActionTerm,
    ): boolean {
        // TODO: Improve this
        // If additional entities, then for now, assume the targetEntities represent an Object in an action
        if (
            isEntityTermArray(actionTerm.additionalEntities) &&
            actionTerm.additionalEntities.length > 0
        ) {
            return true;
        }
        return false;
    }

    private compileEntityTerms(
        entityTerms: querySchema.EntityTerm[],
        termGroup: SearchTermGroup,
        useOrMax: boolean = true,
    ): void {
        if (useOrMax) {
            const orMax = createOrMaxTermGroup();
            for (const term of entityTerms) {
                this.addEntityTermToGroup(term, orMax);
            }
            termGroup.terms.push(orMax);
        } else {
            for (const term of entityTerms) {
                this.addEntityTermToGroup(term, termGroup);
            }
        }
    }

    private addScopingTermsToGroup(
        entityTerms: querySchema.EntityTerm[],
        termGroup: SearchTermGroup,
    ): void {
        /*
        for (const entityTerm of entityTerms) {
            this.addPropertyTermToGroup(
                PropertyNames.EntityName,
                entityTerm.name,
                termGroup,
                this.exactScoping,
            );
        }
        */
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
            if (!entityTerm.isNamePronoun) {
                this.addPropertyTermToGroup(
                    propertyName,
                    entityTerm.name,
                    termGroup,
                    exactMatchValue,
                );
            }
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

    private extractObjects(
        entities: querySchema.EntityTerm[],
    ): querySchema.EntityTerm[] {
        let persons: querySchema.EntityTerm[] = [];
        let i = 0;
        while (i < entities.length) {
            const term = entities[i];
            if (term.isPerson) {
                entities.splice(i, 1);
                persons.push(term);
            } else {
                ++i;
            }
        }
        return persons;
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
