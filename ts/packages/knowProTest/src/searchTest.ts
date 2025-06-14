// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";

export type LangSearchResults = {
    searchText: string;
    searchQueryExpr: kp.querySchema.SearchQuery;
    results: LangSearchResult[];
    error?: string | undefined;
};

export type LangSearchResult = {
    messageMatches: kp.MessageOrdinal[];
    entityMatches?: kp.SemanticRefOrdinal[] | undefined;
    topicMatches?: kp.SemanticRefOrdinal[] | undefined;
    actionMatches?: kp.SemanticRefOrdinal[] | undefined;
};

export function collectLangSearchResults(
    searchText: string,
    searchResults: kp.ConversationSearchResult[],
    debugContext: kp.LanguageSearchDebugContext,
): LangSearchResults {
    return {
        searchText,
        searchQueryExpr: debugContext.searchQuery!,
        results: searchResults.map((cr) => {
            const lr: LangSearchResult = {
                messageMatches: cr.messageMatches.map((m) => m.messageOrdinal),
            };
            getKnowledgeResults(cr, lr);
            return lr;
        }),
    };
}

function getKnowledgeResults(
    cr: kp.ConversationSearchResult,
    lr: LangSearchResult,
) {
    lr.entityMatches = getMatchedSemanticRefOrdinals(cr, "entity");
    lr.topicMatches = getMatchedSemanticRefOrdinals(cr, "topic");
    lr.actionMatches = getMatchedSemanticRefOrdinals(cr, "action");
}

function getMatchedSemanticRefOrdinals(
    cr: kp.ConversationSearchResult,
    type: kp.KnowledgeType,
) {
    return cr.knowledgeMatches
        .get(type)
        ?.semanticRefMatches.map((sr) => sr.semanticRefOrdinal);
}
