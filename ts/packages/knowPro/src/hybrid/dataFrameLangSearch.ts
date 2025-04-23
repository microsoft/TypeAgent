// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PropertySearchTerm,
    ScoredMessageOrdinal,
    SearchSelectExpr,
    SearchTermGroup,
    WhenFilter,
} from "../interfaces.js";
import { FacetTerm, SearchExpr, SearchFilter } from "../searchQuerySchema.js";
import { DataFrameCollection, IConversationHybrid } from "./dataFrame.js";
import {
    DataFrameCompiler,
    getDataFrameAndColumnName,
} from "./dataFrameQuery.js";
import * as search from "../search.js";
import { loadSchemaFiles } from "typeagent";
import { TypeChatLanguageModel, createJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import * as querySchema from "../searchQuerySchema.js";
import {
    compileSearchFilter,
    SearchQueryTranslator,
} from "../searchQueryTranslator.js";
import { createPropertySearchTerm } from "../searchLib.js";

/**
 * EXPERIMENTAL CODE. SUBJECT TO RAPID CHANGE
 */

export async function searchConversationMessages(
    conversation: IConversationHybrid,
    searchExpr: SearchExpr,
    options?: search.SearchOptions | undefined,
): Promise<ScoredMessageOrdinal[][]> {
    const messageMatches: ScoredMessageOrdinal[][] = [];
    for (const searchFilter of searchExpr.filters) {
        const results = await searchConversationWithFilter(
            conversation,
            searchFilter,
            options,
            searchExpr.rewrittenQuery,
        );
        if (results) {
            messageMatches.push(results.messageMatches);
        }
    }
    return messageMatches;
}

export async function searchConversationWithFilter(
    conversation: IConversationHybrid,
    searchFilter: SearchFilter,
    options?: search.SearchOptions | undefined,
    rawQuery?: string,
): Promise<search.ConversationSearchResult | undefined> {
    const selectExpr = compileHybridSearchFilter(conversation, searchFilter);
    return searchConversationWithHybridScope(
        conversation,
        selectExpr.searchTermGroup,
        selectExpr.when,
        options,
        rawQuery,
    );
}

/**
 * Search the hybrid conversation using dataFrames to determine additional
 * 'outer' scope
 * @param hybridConversation
 * @param searchTermGroup
 * @param when
 * @param options
 */
async function searchConversationWithHybridScope(
    hybridConversation: IConversationHybrid,
    searchTermGroup: SearchTermGroup,
    when?: WhenFilter | undefined,
    options?: search.SearchOptions | undefined,
    rawSearchQuery?: string,
): Promise<search.ConversationSearchResult | undefined> {
    const dfCompiler = new DataFrameCompiler(hybridConversation.dataFrames);
    const dfScopeExpr = dfCompiler.compileScope(searchTermGroup);
    if (dfScopeExpr) {
        const scopeRanges = dfScopeExpr.eval();
        if (scopeRanges) {
            when ??= {};
            when.textRangesInScope = scopeRanges.getRanges();
        }
    }
    return search.searchConversation(
        hybridConversation.conversation,
        searchTermGroup,
        when,
        options,
        rawSearchQuery,
    );
}

export function createSearchQueryTranslator(
    dataFrames: DataFrameCollection,
    model: TypeChatLanguageModel,
): SearchQueryTranslator {
    const typeName = "SearchQuery";
    const knownTypes = typeDefForDataFrames(dataFrames);
    const schemaTexts = loadSchemaFiles(
        [
            "../dateTimeSchema.ts",
            //"knownFacetsSchema.ts",
            "searchQuerySchema2.ts",
        ],
        import.meta.url,
    );
    schemaTexts.splice(1, 0, knownTypes);
    const schema = schemaTexts.join("\n");
    return createJsonTranslator<querySchema.SearchQuery>(
        model,
        createTypeScriptJsonValidator<querySchema.SearchQuery>(
            schema,
            typeName,
        ),
    );
}

function compileHybridSearchFilter(
    hybridConversation: IConversationHybrid,
    searchFilter: SearchFilter,
): SearchSelectExpr {
    const dfTerms = extractDataFrameFacetTermsFromFilter(
        hybridConversation.dataFrames,
        searchFilter,
    );
    const selectExpr = compileSearchFilter(
        hybridConversation.conversation,
        searchFilter,
    );
    selectExpr.searchTermGroup.terms.push(...facetTermsToSearchTerms(dfTerms));
    selectExpr.when ??= {};
    return selectExpr;
}

function extractDataFrameFacetTermsFromFilter(
    dataFrames: DataFrameCollection,
    searchFilter: SearchFilter,
    dfFacets?: FacetTerm[],
): FacetTerm[] {
    dfFacets ??= [];
    if (searchFilter.entitySearchTerms) {
        for (const entityTerm of searchFilter.entitySearchTerms) {
            if (entityTerm.facets) {
                const facets = entityTerm.facets;
                entityTerm.facets = [];
                for (const ff of facets) {
                    const [dfName, colName] = getDataFrameAndColumnName(
                        ff.facetName,
                    );
                    if (!dfName || !dataFrames.has(dfName) || !colName) {
                        entityTerm.facets.push(ff);
                    } else {
                        dfFacets.push(ff);
                    }
                }
            }
        }
    }
    return dfFacets;
}

function facetTermsToSearchTerms(
    facetTerms: FacetTerm[],
): PropertySearchTerm[] {
    return facetTerms.map((f) => {
        return createPropertySearchTerm(f.facetName, f.facetValue);
    });
}

function typeDefForDataFrames(dataFrames: DataFrameCollection): string {
    let text = "export type KnownFacet = ";
    let types: string[] = [];
    for (let [dfName, df] of dataFrames) {
        for (const colName of df.columns.keys()) {
            types.push(`"${dfName}.${colName}"`);
        }
    }
    if (types.length > 0) {
        text += types.join(" | ");
    }
    text += ";";
    return text;
}
