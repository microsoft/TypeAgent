// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { intersectScoredMessageOrdinals } from "../collections.js";
import {
    IMessage,
    IConversation,
    ScoredMessageOrdinal,
    SearchTermGroup,
    WhenFilter,
} from "../interfaces.js";
import * as search from "../search.js";
import { DataFrameCollection, searchDataFrames } from "./dataFrame.js";
import { DataFrameCompiler } from "./dataFrameQuery.js";

export interface IConversationHybrid<TMessage extends IMessage = IMessage> {
    get conversation(): IConversation<TMessage>;
    get dataFrames(): DataFrameCollection;
}

export type HybridSearchResults = {
    conversationMatches?: search.ConversationSearchResult | undefined;
    dataFrameMatches?: ScoredMessageOrdinal[] | undefined;
    joinedMatches?: ScoredMessageOrdinal[] | undefined;
};

export async function searchConversationWithJoin(
    hybridConversation: IConversationHybrid,
    searchTermGroup: SearchTermGroup,
    filter?: WhenFilter,
    options?: search.SearchOptions,
    rawQuery?: string,
): Promise<HybridSearchResults> {
    options ??= search.createDefaultSearchOptions();

    const conversationMatches = await search.searchConversation(
        hybridConversation.conversation,
        searchTermGroup,
        filter,
        options,
        rawQuery,
    );
    // Also match any messages with matching data frame columns
    let dataFrameMatches = searchDataFrames(
        hybridConversation.dataFrames,
        searchTermGroup,
        options,
    );

    let joinedMatches = intersectScoredMessageOrdinals(
        conversationMatches?.messageMatches,
        dataFrameMatches,
    );
    return {
        conversationMatches,
        dataFrameMatches,
        joinedMatches,
    };
}

/**
 * Search the hybrid conversation using dataFrames to determine additional
 * 'outer' scope
 * @param hybridConversation
 * @param searchTermGroup
 * @param when
 * @param options
 */

export async function searchConversationWithScope(
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
