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

export async function getLangSearchResult(
    conversation: kp.IConversation | cm.Memory,
    queryTranslator: kp.SearchQueryTranslator,
    searchText: string,
    options?: kp.LanguageSearchOptions,
    langFilter?: kp.LanguageSearchFilter,
    debugContext?: kp.LanguageSearchDebugContext,
) {
    const searchResults =
        conversation instanceof cm.Memory
            ? await conversation.searchWithLanguage(
                  searchText,
                  options,
                  langFilter,
                  debugContext,
              )
            : await kp.searchConversationWithLanguage(
                  conversation,
                  searchText,
                  queryTranslator,
                  options,
                  langFilter,
                  debugContext,
              );

    return searchResults;
}
