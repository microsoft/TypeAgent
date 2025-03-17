// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ProgressBar } from "interactive-app";
import * as knowLib from "knowledge-processor";
import * as kp from "knowpro";
import { ChatPrinter } from "../chatPrinter.js";

export function textLocationToString(location: kp.TextLocation): string {
    let text = `MessageOrdinal: ${location.messageOrdinal}`;
    if (location.chunkOrdinal) {
        text += `\nChunkOrdinal: ${location.chunkOrdinal}`;
    }
    if (location.charOrdinal) {
        text += `\nCharOrdinal: ${location.charOrdinal}`;
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
    let searchResults = await kp.searchConversationKnowledge(
        conversation,
        termGroup,
        when,
        searchOptions,
    );
    if (useAnd && (!searchResults || searchResults.size === 0)) {
        // Try again with OR
        termGroup = termFilterToSearchGroup(filter, false);
        searchResults = await kp.searchConversationKnowledge(
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

export interface IMessageMetadata<TMeta = any> {
    metadata: TMeta;
}
export function createIndexingEventHandler(
    printer: ChatPrinter,
    progress: ProgressBar,
    maxMessages: number,
): kp.IndexingEventHandlers {
    let startedKnowledge = false;
    let startedRelated = false;
    let startedMessages = false;
    return {
        onKnowledgeExtracted() {
            if (!startedKnowledge) {
                printer.writeLine("Indexing knowledge");
                startedKnowledge = true;
            }
            progress.advance();
            return progress.count < maxMessages;
        },
        onEmbeddingsCreated(sourceTexts, batch, batchStartAt) {
            if (!startedRelated) {
                progress.reset(sourceTexts.length);
                printer.writeLine(
                    `Indexing ${sourceTexts.length} related terms`,
                );
                startedRelated = true;
            }
            progress.advance(batch.length);
            return true;
        },
        onTextIndexed(textAndLocations, batch, batchStartAt) {
            if (!startedMessages) {
                progress.reset(textAndLocations.length);
                printer.writeLine(
                    `Indexing ${textAndLocations.length} messages`,
                );
                startedMessages = true;
            }
            progress.advance(batch.length);
            return true;
        },
    };
}
