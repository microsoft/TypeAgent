// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandMetadata, NamedArgs, ProgressBar } from "interactive-app";
import * as knowLib from "knowledge-processor";
import * as kp from "knowpro";
import * as cm from "conversation-memory";
import { MemoryConsoleWriter } from "../memoryWriter.js";
import {
    addFileNameSuffixToPath,
    argToDate,
    keyValuesFromNamedArgs,
} from "../common.js";
import path from "path";
import { dateTime, getFileName } from "typeagent";
import { TypeChatJsonTranslator } from "typechat";

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

export function setKnowledgeTranslator(
    settings: kp.ConversationSettings,
    translator: TypeChatJsonTranslator<knowLib.conversation.KnowledgeResponse>,
) {
    const extractor = settings.semanticRefIndexSettings.knowledgeExtractor;
    if (extractor) {
        extractor.translator = translator;
    }
}

export function setKnowledgeExtractorV2(settings: kp.ConversationSettings) {
    const extractor = settings.semanticRefIndexSettings.knowledgeExtractor;
    if (extractor) {
        const prevTranslator = extractor.translator;
        extractor.translator = kp.createKnowledgeTranslator2(
            extractor.translator!.model,
        );
        return prevTranslator;
    }
    return undefined;
}

export function* batchSemanticRefsByMessage(
    semanticRefs: kp.ISemanticRefCollection,
): IterableIterator<[kp.MessageOrdinal, kp.SemanticRef[]]> {
    let srs: kp.SemanticRef[] = [];
    let prevOrdinal: kp.MessageOrdinal = -1;
    for (const sr of semanticRefs) {
        if (sr.range.start.messageOrdinal !== prevOrdinal && srs.length > 0) {
            yield [prevOrdinal, srs];
            srs = [];
        }
        srs.push(sr);
        prevOrdinal = sr.range.start.messageOrdinal;
    }
    if (srs.length > 0) {
        yield [prevOrdinal, srs];
    }
}

export function createSearchGroup(
    termArgs: string[],
    namedArgs: NamedArgs,
    commandDef: CommandMetadata,
    op: "and" | "or" | "or_max",
): kp.SearchTermGroup {
    const searchTerms = kp.createSearchTerms(termArgs);
    const propertyTerms = propertyTermsFromNamedArgs(namedArgs, commandDef);
    return {
        booleanOp: op,
        terms: [...searchTerms, ...propertyTerms],
    };
}

export function propertyTermsFromNamedArgs(
    namedArgs: NamedArgs,
    commandDef: CommandMetadata,
): kp.PropertySearchTerm[] {
    const keyValues = keyValuesFromNamedArgs(namedArgs, commandDef);
    return kp.createPropertySearchTerms(keyValues);
}

export function whenFilterFromNamedArgs(
    conversation: kp.IConversation,
    namedArgs: NamedArgs,
): kp.WhenFilter {
    let filter: kp.WhenFilter = {
        knowledgeType: namedArgs.ktype,
    };
    const dateRange = kp.getTimeRangeForConversation(conversation!);
    if (dateRange) {
        let startDate: Date | undefined;
        let endDate: Date | undefined;
        // Did they provide an explicit date range?
        if (namedArgs.startDate || namedArgs.endDate) {
            startDate = argToDate(namedArgs.startDate) ?? dateRange.start;
            endDate = argToDate(namedArgs.endDate) ?? dateRange.end;
        } else {
            // They may have provided a relative date range
            if (namedArgs.startMinute >= 0) {
                startDate = dateTime.addMinutesToDate(
                    dateRange.start,
                    namedArgs.startMinute,
                );
            }
            if (namedArgs.endMinute > 0) {
                endDate = dateTime.addMinutesToDate(
                    dateRange.start,
                    namedArgs.endMinute,
                );
            }
        }
        if (startDate) {
            filter.dateRange = {
                start: startDate,
                end: endDate,
            };
        }
    }
    return filter;
}

export function dateRangeFromNamedArgs(
    namedArgs: NamedArgs,
): kp.DateRange | undefined {
    let startDate = argToDate(namedArgs.startDate);
    let endDate = argToDate(namedArgs.endDate);
    if (startDate) {
        return {
            start: startDate,
            end: endDate,
        };
    }
    return undefined;
}
