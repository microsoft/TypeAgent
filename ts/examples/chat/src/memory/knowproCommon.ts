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
    knowledgeType: kp.KnowledgeType | undefined,
    searchOptions: kp.SearchOptions,
    useAnd: boolean = false,
) {
    let termGroup: kp.SearchTermGroup = termFilterToSearchGroup(filter, useAnd);
    if (filter.action) {
        let actionGroup: kp.SearchTermGroup = actionFilterToSearchGroup(
            filter.action,
            useAnd,
        );
        // Just flatten for now...
        termGroup.terms.push(...actionGroup.terms);
    }
    let when: kp.WhenFilter = termFilterToWhenFilter(filter);
    when.knowledgeType = knowledgeType;
    let searchResults = await kp.searchConversation(
        conversation,
        termGroup,
        when,
        searchOptions,
    );
    if (useAnd && (!searchResults || searchResults.size === 0)) {
        // Try again with OR
        termGroup = termFilterToSearchGroup(filter, false);
        searchResults = await kp.searchConversation(
            conversation,
            termGroup,
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
): kp.WhenFilter {
    let when: kp.WhenFilter = {};
    if (filter.timeRange) {
        when.dateRange = {
            start: knowLib.conversation.toStartDate(filter.timeRange.startDate),
            end: knowLib.conversation.toStopDate(filter.timeRange.stopDate),
        };
    }
    return when;
}

export function actionFilterToSearchGroup(
    action: knowLib.conversation.ActionTerm,
    and: boolean,
): kp.SearchTermGroup {
    const searchTermGroup: kp.SearchTermGroup = {
        booleanOp: and ? "and" : "or",
        terms: [],
    };

    if (action.verbs) {
        searchTermGroup.terms.push(
            ...action.verbs.words.map((v) => {
                return kp.createPropertySearchTerm(kp.PropertyNames.Verb, v);
            }),
        );
    }
    if (action.subject !== "none") {
        searchTermGroup.terms.push(
            kp.createPropertySearchTerm(
                kp.PropertyNames.Subject,
                action.subject.subject,
            ),
        );
    }
    if (action.object) {
        searchTermGroup.terms.push(kp.createSearchTerm(action.object));
    }
    return searchTermGroup;
}
