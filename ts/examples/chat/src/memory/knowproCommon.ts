// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ProgressBar } from "interactive-app";
import * as knowLib from "knowledge-processor";
import * as kp from "knowpro";
import * as cm from "conversation-memory";
import { MemoryConsoleWriter } from "../memoryWriter.js";
import { addFileNameSuffixToPath } from "../common.js";
import path from "path";
import { getFileName } from "typeagent";

/**
 * Appends the given messages and their pre-extracted associated knowledge to the conversation index
 * Will no do any knowledge extraction.
 * @param conversation
 * @param messages
 * @param knowledgeResponses
 */
export function addToConversation(
    conversation: kp.IConversation,
    messages: kp.IMessage[],
    knowledgeResponses: knowLib.conversation.KnowledgeResponse[],
): void {
    beginIndexing(conversation);
    for (let i = 0; i < messages.length; i++) {
        const messageOrdinal: kp.MessageOrdinal = conversation.messages.length;
        const chunkOrdinal = 0;
        conversation.messages.append(messages[i]);
        const knowledge = knowledgeResponses[i];
        if (knowledge) {
            kp.addKnowledgeToSemanticRefIndex(
                conversation,
                messageOrdinal,
                chunkOrdinal,
                knowledge,
            );
        }
    }
}

function beginIndexing(conversation: kp.IConversation) {
    if (conversation.semanticRefIndex === undefined) {
        conversation.semanticRefIndex = new kp.ConversationIndex();
    }
    if (conversation.semanticRefs === undefined) {
        conversation.semanticRefs = new kp.SemanticRefCollection();
    }
}

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
    printer: MemoryConsoleWriter,
    progress: ProgressBar,
    maxMessages: number,
    debugMode: boolean = false,
): kp.IndexingEventHandlers {
    let startedKnowledge = false;
    let startedRelated = false;
    let startedMessages = false;
    return {
        onKnowledgeExtracted(upto, knowledge) {
            if (!startedKnowledge) {
                printer.writeLine("Indexing knowledge");
                startedKnowledge = true;
            }
            if (debugMode) {
                printer.writeLine("================");
                printer.writeJson(knowledge);
                printer.writeLine("================");
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
                progress.reset(maxMessages);
                printer.writeLine(`Indexing ${maxMessages} messages`);
                startedMessages = true;
            }
            progress.advance(batch.length);
            return true;
        },
    };
}

export function hasConversationResults(
    results: kp.ConversationSearchResult[],
): boolean {
    if (results.length === 0) {
        return false;
    }
    return results.some((r) => {
        return r.knowledgeMatches.size > 0 || r.messageMatches.length > 0;
    });
}

const IndexFileSuffix = "_index.json";
export function sourcePathToMemoryIndexPath(
    sourcePath: string,
    indexFilePath?: string,
): string {
    return (
        indexFilePath ?? addFileNameSuffixToPath(sourcePath, IndexFileSuffix)
    );
}

export function memoryNameToIndexPath(
    basePath: string,
    memoryName: string,
): string {
    return path.join(basePath, memoryName + IndexFileSuffix);
}

export async function loadEmailMemory(
    emailIndexPath: string,
    createNew: boolean = false,
) {
    return cm.createEmailMemory(
        {
            dirPath: path.dirname(emailIndexPath),
            baseFileName: getFileName(emailIndexPath),
        },
        createNew,
    );
}
