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
    createWhenFilterForDateTimeRange,
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

export function createSearchFilterExpr(): SearchSelectExpr {
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

    private compileFilterExpr(
        filter: SearchFilter,
        filterExpr?: SearchSelectExpr,
    ): SearchSelectExpr {
        filterExpr ??= createSearchFilterExpr();
        if (filter.entitySearchTerms) {
            this.addEntityTerms(
                filter.entitySearchTerms,
                filterExpr.searchTermGroup,
            );
        }
        if (filter.actionSearchTerm) {
            this.addActionTerms(
                filter.actionSearchTerm,
                filterExpr.searchTermGroup,
            );
            this.addEntityTermsForAction(
                filter.actionSearchTerm,
                filterExpr.searchTermGroup,
            );
        }
        if (filter.searchTerms) {
            this.addSearchTerms(filter.searchTerms, filterExpr.searchTermGroup);
        }
        if (filter.timeRange) {
            filterExpr.when = createWhenFilterForDateTimeRange(
                filter.timeRange,
            );
        }
        return filterExpr;
    }

    private addEntityTerms(
        entityTerms: EntityTerm[],
        termGroup: SearchTermGroup,
    ): void {
        if (entityTerms && entityTerms.length > 0) {
            for (const entityTerm of entityTerms) {
                this.addEntityTerm(entityTerm, termGroup);
            }
        }
    }

    private addEntityTerm(
        entityTerm: EntityTerm,
        termGroup: SearchTermGroup,
    ): void {
        this.addPropertyTerm(
            PropertyNames.EntityName,
            entityTerm.name,
            termGroup,
        );
        if (entityTerm.type) {
            for (const type of entityTerm.type) {
                this.addPropertyTerm(PropertyNames.EntityType, type, termGroup);
            }
        }
        if (entityTerm.facets && entityTerm.facets.length > 0) {
            for (const facetTerm of entityTerm.facets) {
                const nameWildcard = isWildcard(facetTerm.facetName);
                const valueWildcard = isWildcard(facetTerm.facetValue);
                if (!(nameWildcard && valueWildcard)) {
                    this.addPropertyTerm(
                        facetTerm.facetName,
                        facetTerm.facetValue,
                        termGroup,
                    );
                } else if (nameWildcard) {
                    this.addPropertyTerm(
                        PropertyNames.FacetValue,
                        facetTerm.facetValue,
                        termGroup,
                    );
                } else if (valueWildcard) {
                    this.addPropertyTerm(
                        PropertyNames.FacetName,
                        facetTerm.facetName,
                        termGroup,
                    );
                }
            }
        }
    }

    private addActionTerms(
        actionTerm: ActionTerm,
        termGroup: SearchTermGroup,
    ): void {
        if (actionTerm.actionVerbs) {
            for (const verb of actionTerm.actionVerbs.words) {
                this.addPropertyTerm(PropertyNames.Verb, verb, termGroup);
            }
        }
        if (isEntityTermArray(actionTerm.actorEntities)) {
            this.addEntityNames(
                actionTerm.actorEntities,
                PropertyNames.Subject,
                termGroup,
            );
        }
        if (isEntityTermArray(actionTerm.targetEntities)) {
            this.addEntityNames(
                actionTerm.targetEntities,
                PropertyNames.Object,
                termGroup,
            );
            /*
            this.addEntityNames(
                actionTerm.targetEntities,
                PropertyNames.IndirectObject,
                termGroup,
            );
            */
        }
    }

    private addEntityTermsForAction(
        actionTerm: ActionTerm,
        termGroup: SearchTermGroup,
    ): void {
        if (isEntityTermArray(actionTerm.actorEntities)) {
            this.addEntityTerms(actionTerm.actorEntities, termGroup);
        }
        if (isEntityTermArray(actionTerm.targetEntities)) {
            this.addEntityTerms(actionTerm.targetEntities, termGroup);
        }
        if (isEntityTermArray(actionTerm.additionalEntities)) {
            this.addEntityTerms(actionTerm.additionalEntities, termGroup);
        }
    }

    private addEntityNames(
        entityTerms: EntityTerm[],
        propertyName: PropertyNames,
        termGroup: SearchTermGroup,
    ): void {
        for (const entityTerm of entityTerms) {
            this.addPropertyTerm(propertyName, entityTerm.name, termGroup);
        }
    }

    private addPropertyTerm(
        propertyName: string,
        propertyValue: string,
        termGroup: SearchTermGroup,
    ): void {
        if (isWildcard(propertyValue)) {
            return;
        }
        // Dedupe
        if (!this.entityTermsAdded.has(propertyName, propertyValue)) {
            const searchTerm = createPropertySearchTerm(
                propertyName,
                propertyValue,
            );
            termGroup.terms.push(searchTerm);
            this.entityTermsAdded.add(
                propertyName,
                searchTerm.propertyValue.term,
            );
        }
    }

    private addSearchTerms(
        searchTerms: string[],
        termGroup: SearchTermGroup,
    ): void {
        for (const searchTerm of searchTerms) {
            termGroup.terms.push(createSearchTerm(searchTerm));
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
