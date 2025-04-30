// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PropertySearchTerm,
    ScoredMessageOrdinal,
    SearchSelectExpr,
} from "../interfaces.js";
import * as querySchema from "../searchQuerySchema.js";
import { DataFrameCollection } from "./dataFrame.js";
import {
    IConversationWithDataFrame,
    searchConversationWithScope,
} from "./dataFrameConversation.js";
import { getDataFrameAndColumnName } from "./dataFrameQuery.js";
import * as search from "../search.js";
import { loadSchemaFiles } from "typeagent";
import { TypeChatLanguageModel, createJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { SearchQueryTranslator } from "../searchQueryTranslator.js";
import { compileSearchFilter } from "../searchLang.js";
import { createPropertySearchTerm } from "../searchLib.js";

/**
 * EXPERIMENTAL CODE. SUBJECT TO RAPID CHANGE
 */

export async function searchConversationMessages(
    conversation: IConversationWithDataFrame,
    searchExpr: querySchema.SearchExpr,
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

async function searchConversationWithFilter(
    conversation: IConversationWithDataFrame,
    searchFilter: querySchema.SearchFilter,
    options?: search.SearchOptions | undefined,
    rawQuery?: string,
): Promise<search.ConversationSearchResult | undefined> {
    const selectExpr = compileDfSearchFilter(conversation, searchFilter);
    return searchConversationWithScope(
        conversation,
        selectExpr.searchTermGroup,
        selectExpr.when,
        options,
        rawQuery,
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

function compileDfSearchFilter(
    dfConversation: IConversationWithDataFrame,
    searchFilter: querySchema.SearchFilter,
): SearchSelectExpr {
    const dfTerms = extractDataFrameFacetTermsFromFilter(
        dfConversation.dataFrames,
        searchFilter,
    );
    const selectExpr = compileSearchFilter(
        dfConversation.conversation,
        searchFilter,
    );
    selectExpr.searchTermGroup.terms.push(...facetTermsToSearchTerms(dfTerms));
    selectExpr.when ??= {};
    return selectExpr;
}

function extractDataFrameFacetTermsFromFilter(
    dataFrames: DataFrameCollection,
    searchFilter: querySchema.SearchFilter,
    dfFacets?: querySchema.FacetTerm[],
): querySchema.FacetTerm[] {
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
    facetTerms: querySchema.FacetTerm[],
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
