// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createJsonTranslator,
    Result,
    success,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
} from "typechat";
import {
    ActionTerm,
    EntityTerm,
    SearchExpr,
    SearchFilter,
    SearchQuery,
} from "./searchQuerySchema.js";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { loadSchema } from "typeagent";
import {
    createPropertySearchTerm,
    createSearchTerm,
    SearchTermGroup,
    dateRangeFromDateTimeRange,
    WhenFilter,
} from "./search.js";
import { PropertyNames } from "./propertyIndex.js";
import { PropertyTermSet } from "./collections.js";
import { IConversation } from "./interfaces.js";
import { getTimeRangePromptSectionForConversation } from "./conversation.js";

/*-------------------------------

    EXPERIMENTAL CODE
    Frequent changes

---------------------------------*/

export type SearchQueryTranslator = TypeChatJsonTranslator<SearchQuery>;

export function createSearchQueryTranslator(
    model: TypeChatLanguageModel,
): SearchQueryTranslator {
    const typeName = "SearchQuery";
    const searchActionSchema = loadSchema(
        ["dateTimeSchema.ts", "searchQuerySchema.ts"],
        import.meta.url,
    );

    return createJsonTranslator<SearchQuery>(
        model,
        createTypeScriptJsonValidator<SearchQuery>(
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

export async function textQueryToSearchQueryExpr(
    conversation: IConversation,
    queryTranslator: SearchQueryTranslator,
    textQuery: string,
): Promise<Result<[SearchQueryExpr[], SearchQuery]>> {
    const result = await queryTranslator.translate(
        textQuery,
        getTimeRangePromptSectionForConversation(conversation),
    );
    if (!result.success) {
        return result;
    }
    const searchQuery = result.data;
    const queryBuilder = new SearchQueryExprBuilder();
    const queryExpr = queryBuilder.compileQuery(searchQuery);
    return success([queryExpr, searchQuery]);
}

export class SearchQueryExprBuilder {
    private entityTermsAdded: PropertyTermSet;
    public queryExpressions: SearchQueryExpr[];

    constructor() {
        this.queryExpressions = [{ selectExpressions: [] }];
        this.entityTermsAdded = new PropertyTermSet();
    }

    public compileQuery(query: SearchQuery): SearchQueryExpr[] {
        const queryExpressions: SearchQueryExpr[] = [];
        for (const searchExpr of query.searchExpressions) {
            queryExpressions.push(this.compileSearchExpr(searchExpr));
        }
        return queryExpressions;
    }

    private compileSearchExpr(expr: SearchExpr): SearchQueryExpr {
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

    private compileFilterExpr(filter: SearchFilter): SearchSelectExpr {
        let searchTermGroup = this.compileTermGroup(filter);
        let when = this.compileWhen(filter);
        return {
            searchTermGroup,
            when,
        };
    }

    private compileTermGroup(filter: SearchFilter): SearchTermGroup {
        const termGroup: SearchTermGroup = { booleanOp: "or", terms: [] };
        this.entityTermsAdded.clear();
        if (filter.entitySearchTerms) {
            this.addEntityTermsToGroup(filter.entitySearchTerms, termGroup);
        }
        if (filter.actionSearchTerm) {
            this.addActionTermsToGroup(filter.actionSearchTerm, termGroup);
            this.addEntityTermsForActionToGroup(
                filter.actionSearchTerm,
                termGroup,
            );
        }
        if (filter.searchTerms) {
            this.addSearchTermsToGroup(filter.searchTerms, termGroup);
        }
        return termGroup;
    }

    private compileWhen(filter: SearchFilter) {
        let when: WhenFilter | undefined;
        if (filter.actionSearchTerm) {
            if (
                isEntityTermArray(filter.actionSearchTerm.additionalEntities) &&
                filter.actionSearchTerm.additionalEntities.length > 0
            ) {
                when ??= {};
                when.scopeDefiningTerms = { booleanOp: "and", terms: [] };
                this.entityTermsAdded.clear();
                this.addScopingTermsToGroup(
                    filter.actionSearchTerm.additionalEntities,
                    when.scopeDefiningTerms,
                );
            }
        }
        if (filter.timeRange) {
            when ??= {};
            when.dateRange = dateRangeFromDateTimeRange(filter.timeRange);
        }
        return when;
    }

    private addEntityTermsToGroup(
        entityTerms: EntityTerm[],
        termGroup: SearchTermGroup,
        dedupe: boolean = true,
    ): void {
        if (entityTerms && entityTerms.length > 0) {
            for (const entityTerm of entityTerms) {
                this.addEntityTermToGroup(entityTerm, termGroup, dedupe);
            }
        }
    }

    private addEntityTermToGroup(
        entityTerm: EntityTerm,
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
        actionTerm: ActionTerm,
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
            this.addEntityNamesToGroup(
                actionTerm.targetEntities,
                PropertyNames.Object,
                termGroup,
            );
            // TODO: make IndirectObject an or?
            /*
            this.addEntityNames(
                actionTerm.targetEntities,
                PropertyNames.IndirectObject,
                termGroup,
            );
            */
        }
    }

    private addEntityTermsForActionToGroup(
        actionTerm: ActionTerm,
        termGroup: SearchTermGroup,
    ): void {
        if (isEntityTermArray(actionTerm.actorEntities)) {
            this.addEntityTermsToGroup(actionTerm.actorEntities, termGroup);
        }
        if (isEntityTermArray(actionTerm.targetEntities)) {
            this.addEntityTermsToGroup(actionTerm.targetEntities, termGroup);
        }
        if (isEntityTermArray(actionTerm.additionalEntities)) {
            this.addEntityTermsToGroup(
                actionTerm.additionalEntities,
                termGroup,
            );
        }
    }

    private addScopingTermsToGroup(
        entityTerms: EntityTerm[],
        termGroup: SearchTermGroup,
    ): void {
        for (const entityTerm of entityTerms) {
            this.addEntityTermToGroup(
                entityTerm,
                termGroup,
                true /* exact match name */,
            );
        }
    }

    private addEntityNamesToGroup(
        entityTerms: EntityTerm[],
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
                return true;
        }
    }
}

const Wildcard = "*";

function isEntityTermArray(
    terms: EntityTerm[] | "*" | undefined,
): terms is EntityTerm[] {
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
