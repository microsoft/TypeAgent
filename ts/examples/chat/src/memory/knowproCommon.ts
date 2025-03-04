// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as knowLib from "knowledge-processor";
import * as kp from "knowpro";

export function textLocationToString(location: kp.TextLocation): string {
    let text = `MessageIndex: ${location.messageIndex}`;
    if (location.chunkIndex) {
        text += `\nChunkIndex: ${location.chunkIndex}`;
    }
    if (location.charIndex) {
        text += `\nCharIndex: ${location.charIndex}`;
    }
    return text;
}

export async function matchFilterToConversation(
    conversation: kp.IConversation,
    filter: knowLib.conversation.TermFilterV2,
    knowledgeType?: kp.KnowledgeType | undefined,
    useAnd: boolean = false,
) {
    let searchTermGroup: kp.SearchTermGroup = termFilterToSearchGroup(
        filter,
        useAnd,
    );
    let when: kp.WhenFilter = termFilterToWhenFilter(filter);
    when.knowledgeType = knowledgeType;
    let searchResults = await kp.searchConversation(
        conversation,
        searchTermGroup,
        when,
    );
    if (useAnd && (!searchResults || searchResults.size === 0)) {
        // Try again with OR
        searchTermGroup = termFilterToSearchGroup(filter, false);
        searchResults = await kp.searchConversation(
            conversation,
            searchTermGroup,
            when,
        );
    }
    return searchResults;
}

export function termFilterToSearchGroup(
    filter: knowLib.conversation.TermFilterV2,
    and: boolean,
): kp.SearchTermGroup {
    const searchTermGroup: kp.SearchTermGroup = {
        booleanOp: and ? "and" : "or",
        terms: [],
    };
    if (filter.searchTerms && filter.searchTerms.length > 0) {
        for (const st of filter.searchTerms) {
            searchTermGroup.terms.push({ term: { text: st } });
        }
    }
    return searchTermGroup;
}

export function termFilterToWhenFilter(
    filter: knowLib.conversation.TermFilterV2,
) {
    let when: kp.WhenFilter = {};
    if (filter.timeRange) {
        when.dateRange = {
            start: knowLib.conversation.toStartDate(filter.timeRange.startDate),
            end: knowLib.conversation.toStopDate(filter.timeRange.stopDate),
        };
    }
    return when;
}
