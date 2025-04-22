// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ScoredMessageOrdinal,
    SearchTermGroup,
    WhenFilter,
} from "../interfaces.js";
import { SearchExpr, SearchFilter } from "../searchQuerySchema.js";
import { compileHybridSearchFilter, IConversationHybrid } from "./dataFrame.js";
import { DataFrameCompiler } from "./dataFrameQuery.js";
import * as search from "../search.js";
import { loadSchema } from "typeagent";
import { TypeChatLanguageModel, createJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import * as querySchema from "../searchQuerySchema.js";
import { SearchQueryTranslator } from "../searchQueryTranslator.js";

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
    model: TypeChatLanguageModel,
): SearchQueryTranslator {
    const typeName = "SearchQuery";
    const searchActionSchema = loadSchema(
        [
            "../dateTimeSchema.ts",
            "knownFacetsSchema.ts",
            "searchQuerySchema2.ts",
        ],
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
