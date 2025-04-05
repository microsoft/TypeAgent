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
    dateRangeFromDateTimeRange,
    SearchSelectExpr,
    WhenFilter,
} from "./search.js";
import { createPropertySearchTerm, createSearchTerm } from "./searchLib.js";
import { SearchTermGroup } from "./interfaces.js";
import { /*isKnownProperty,*/ PropertyNames } from "./propertyIndex.js";
import { PropertyTermSet } from "./collections.js";
import { IConversation } from "./interfaces.js";
import { getTimeRangePromptSectionForConversation } from "./conversation.js";
import {
    createAndTermGroup,
    createOrMaxTermGroup,
    createOrTermGroup,
} from "./searchLib.js";

/**
 * A TypeChat Translator that turns natural language into structured queries
 * of type: {@link SearchQuery}
 */
export type SearchQueryTranslator =
    TypeChatJsonTranslator<querySchema.SearchQuery>;

/**
 * Create a query translator using
 * @param {TypeChatLanguageModel} model
 * @returns {SearchQueryTranslator}
 */
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
    const queryBuilder = new SearchQueryCompiler(conversation);
    queryBuilder.exactScoping = exactScoping;
    const searchQueryExprs: SearchQueryExpr[] =
        queryBuilder.compileQuery(query);
    return searchQueryExprs;
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
            termGroup.terms.push(
                this.compileActionTerm(filter.actionSearchTerm),
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

    private compileActionTerm(
        actionTerm: querySchema.ActionTerm,
    ): SearchTermGroup {
        const termGroup = createAndTermGroup();
        if (actionTerm.actionVerbs !== undefined) {
            this.addVerbsToGroup(actionTerm.actionVerbs, termGroup);
        }
        if (isEntityTermArray(actionTerm.actorEntities)) {
            this.addEntityNamesToGroup(
                actionTerm.actorEntities,
                PropertyNames.Subject,
                termGroup,
            );
        }
        if (isEntityTermArray(actionTerm.targetEntities)) {
            let objectTerms = createOrTermGroup();
            this.addEntityNamesToGroup(
                actionTerm.targetEntities,
                PropertyNames.Object,
                objectTerms,
            );
            if (objectTerms.terms.length == 1) {
                termGroup.terms.push(objectTerms.terms[0]);
            } else if (objectTerms.terms.length > 1) {
                termGroup.terms.push(objectTerms);
            }
        }
        return termGroup;
    }

    private compileActionTermAsSearchTerms(
        actionTerm: querySchema.ActionTerm,
        termGroup?: SearchTermGroup,
    ): SearchTermGroup {
        termGroup ??= createOrTermGroup();
        if (actionTerm.actionVerbs !== undefined) {
            this.compileSearchTerms(actionTerm.actionVerbs.words, termGroup);
        }
        if (isEntityTermArray(actionTerm.targetEntities)) {
            this.compileEntityTerms(actionTerm.targetEntities, termGroup);
        }
        if (isEntityTermArray(actionTerm.additionalEntities)) {
            this.compileEntityTerms(actionTerm.additionalEntities, termGroup);
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
            for (const term of entityTerms) {
                const orMax = createOrMaxTermGroup();
                this.addEntityTermToGroup(term, orMax);
                termGroup.terms.push(orMax);
            }
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
        try {
            this.dedupe = false;
            let termGroup: SearchTermGroup;
            if (isEntityTermArray(actionTerm.targetEntities)) {
                termGroup = createOrTermGroup();
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
            return termGroup;
        } finally {
            this.dedupe = dedupe;
        }
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
