// Copyright (c) Microsoft Corporation and Henry Lucco.
// Licensed under the MIT License.

import { conversation } from "knowledge-processor";
import * as knowLib from "knowledge-processor";
import {
    ChatContext,
    Models,
    ReservedConversationNames,
} from "./chatMemory.js";
import { sqlite } from "memory-providers";
import { elastic } from "memory-providers";
import {
    arg,
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
    NamedArgs,
    parseNamedArguments,
    ProgressBar,
} from "interactive-app";
import {
    argClean,
    argPause,
    argSourceFileOrFolder,
    argToDate,
    manageConversationAlias,
} from "./common.js";
import path from "path";
import {
    asyncArray,
    createWorkQueueFolder,
    dateTime,
    ensureDir,
    getFileName,
    isDirectoryPath,
    isFilePath,
    NameValue,
    removeDir,
} from "typeagent";
import { runImportQueue } from "./importer.js";
import chalk from "chalk";
import * as kp from "knowpro";
import * as cm from "conversation-memory";
import { createIndexingEventHandler } from "./knowproCommon.js";

export async function createPodcastMemory(
    models: Models,
    storePath: string,
    settings: conversation.ConversationSettings,
    useSqlite: boolean = false,
    useElastic: boolean = false,
    createNew: boolean = false,
) {
    const podcastStorePath = path.join(
        storePath,
        ReservedConversationNames.podcasts,
    );
    await ensureDir(podcastStorePath);
    let storageProvider = undefined;
    if (useElastic) {
        storageProvider = await elastic.createStorageIndex(createNew);
    } else if (useSqlite) {
        storageProvider = await sqlite.createStorageDb(
            podcastStorePath,
            "podcast.db",
            createNew,
        );
    }

    const cm = await conversation.createConversationManagerEx(
        {
            model: models.chatModel,
            answerModel: models.answerModel,
        },
        settings,
        ReservedConversationNames.podcasts,
        podcastStorePath,
        storageProvider,
    );
    cm.searchProcessor.settings.defaultEntitySearchOptions =
        conversation.createEntitySearchOptions(true);
    cm.searchProcessor.settings.defaultEntitySearchOptions.topK = 10;
    //cm.searchProcessor.settings.defaultEntitySearchOptions.alwaysUseTags = true;
    cm.searchProcessor.answers.settings.chunking.fastStop = true;
    cm.searchProcessor.answers.settings.chunking.enable = true;
    cm.searchProcessor.answers.settings.hints =
        //"When answering questions about 'conversation' include all entities, topics and messages from [CONVERSATION HISTORY].\n" +
        //"What was talked about/discussed is in conversation history as entities, topics and messages. Be sure to use them, not just messages.\n" +
        "Always use supplied messages, ENTITIES AND ANSWERS in your answers.\n" +
        `E.g. include entities in answers to queries like "'they' talked about' \n` +
        "Queries for lists always mean 'full list'";
    return cm;
}

export function createPodcastCommands(
    context: ChatContext,
    commands: Record<string, CommandHandler>,
): void {
    commands.importPodcast = importPodcast;
    commands.podcastConvert = podcastConvert;
    commands.podcastIndex = podcastIndex;
    commands.podcastAddThread = podcastAddThread;
    commands.podcastList = podcastListThreads;
    commands.podcastAddThreadTag = podcastAddThreadTag;
    commands.podcastRemoveThreadTag = podcastRemoveThreadTag;
    //commands.podcastListThreadEntities = podcastListThreadEntities;
    commands.podcastAlias = podcastAlias;
    commands.podcastEntities = podcastEntities;
    commands.podcastSearch = podcastSearch;
    commands.podcastExport = podcastExport;

    //-----------
    // COMMANDS
    //---------
    function importPodcastDef(): CommandMetadata {
        return {
            description: "Import a podcast transcript.",
            args: {
                sourcePath: argSourceFileOrFolder(),
                name: arg("Podcast name"),
                description: arg("Podcast description"),
            },
            options: {
                startAt: arg("Start date and time"),
                length: argNum("Length of the podcast in minutes", 60),
                clean: argClean(),
                maxTurns: argNum("Max turns"),
                pauseMs: argPause(1000),
            },
        };
    }
    commands.importPodcast.metadata = importPodcastDef();
    async function importPodcast(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, importPodcastDef());
        let sourcePath: string = namedArgs.sourcePath;
        if (!isFilePath(sourcePath)) {
            context.printer.writeError(`${sourcePath} is not a file`);
            return;
        }

        await podcastConvert(namedArgs);
        await podcastAddThread(namedArgs);
        const turnsFilePath = getTurnsFolderPath(sourcePath);
        namedArgs.sourcePath = turnsFilePath;
        await podcastIndex(namedArgs);
    }

    function podcastExportDef(): CommandMetadata {
        return {
            description: "Export podcast to knowpro format",
            args: {
                filePath: arg("Output filePath"),
            },
            options: {
                threads: argBool("Export threads", true),
                maxThreads: argNum("Max threads"),
            },
        };
    }
    commands.podcastExport.metadata = podcastExportDef();
    async function podcastExport(args: string[]) {
        const namedArgs = parseNamedArguments(args, podcastExportDef());
        const dirName = path.dirname(namedArgs.filePath);
        const baseFileName = getFileName(namedArgs.filePath);
        context.printer.writeLine(
            `Exporting to ${dirName} with base file name ${baseFileName}`,
        );
        await ensureDir(dirName);

        const messageStore = context.podcastMemory.conversation.messages;
        const threads =
            await context.podcastMemory.conversation.getThreadIndex();
        const knowledgeStore = context.podcastMemory.conversation.knowledge;
        const knowledgeResponses: conversation.KnowledgeResponse[] = [];

        let allThreads = await asyncArray.toArray(threads.entries());
        if (namedArgs.maxThreads && namedArgs.maxThreads > 0) {
            allThreads = allThreads.slice(0, namedArgs.maxThreads);
        }
        context.printer.writeLine(`Exporting ${allThreads.length} threads`);
        const podcastMessages: cm.PodcastMessage[] = [];
        const podcastThreads: kp.Thread[] = [];
        for (const threadEntry of allThreads) {
            const thread = threadEntry.value;
            context.printer.writeInColor(chalk.cyan, thread.description);
            const range = conversation.toDateRange(thread.timeRange);
            const messageIds = await messageStore.getIdsInRange(
                range.startDate,
                range.stopDate,
            );
            let threadRange: kp.TextRange = {
                start: {
                    messageOrdinal: podcastMessages.length,
                },
            };
            const messages = await messageStore.getMultiple(messageIds);
            const progress = new ProgressBar(context.printer, messages.length);
            for (let i = 0; i < messageIds.length; ++i) {
                const messageId = messageIds[i];
                const message = messages[i]!;
                const podcastMessage = podcastMessageFromEmailText(
                    message.value.value,
                );
                podcastMessage.timestamp = message.timestamp.toISOString();
                threadRange.end = {
                    messageOrdinal: podcastMessages.length,
                };
                podcastMessages.push(podcastMessage);
                knowledgeResponses.push(
                    extractedKnowledgeToResponse(
                        await knowledgeStore.get(messageId),
                    ),
                );
                progress.advance();
            }
            progress.complete();
            podcastThreads.push({
                description: thread.description,
                ranges: [threadRange],
            });
        }

        const kpPodcast = new cm.Podcast("AllEpisodes");
        kp.addToConversationIndex(
            kpPodcast,
            podcastMessages,
            knowledgeResponses,
        );
        kpPodcast.secondaryIndexes.threads.threads.push(...podcastThreads);
        const progress = new ProgressBar(
            context.printer,
            podcastMessages.length,
        );

        context.printer.writeLine("Building secondary indexes");
        await kp.buildSecondaryIndexes(
            kpPodcast,
            kpPodcast.settings,
            createIndexingEventHandler(
                context.printer,
                progress,
                podcastMessages.length,
            ),
        );
        progress.complete();

        context.printer.writeLine("Saving index");
        await kpPodcast.writeToFile(dirName, baseFileName);
    }

    // Eventually we should unite these functions with their
    // counterparts in @entities command in chatMemory.ts but
    // need input.
    async function loadMessages(
        ids?: string[],
    ): Promise<(dateTime.Timestamped<knowLib.TextBlock> | undefined)[]> {
        if (ids && ids.length > 0) {
            return await context.podcastMemory.conversation.messages.getMultiple(
                ids,
            );
        }
        return [];
    }

    async function writeEntitiesById(
        index: knowLib.conversation.EntityIndex,
        entityIds: string[],
        showMessages?: boolean,
    ): Promise<void> {
        if (!entityIds || entityIds.length === 0) {
            return;
        }
        if (showMessages) {
            const messages = await loadMessages(
                await index.getSourceIds(entityIds),
            );
            context.printer.writeTemporalBlocks(chalk.cyan, messages);
        } else {
            const entities = await asyncArray.mapAsync(
                entityIds,
                context.searchConcurrency,
                (id) => index.get(id),
            );
            const composite = conversation.mergeEntities(
                knowLib.sets.removeUndefined(entities.map((e) => e?.value)),
            );
            for (const value of composite.values()) {
                context.printer.writeCompositeEntity(value.value);
                context.printer.writeLine();
            }
        }
    }

    async function searchEntities(
        query: string,
        name: boolean,
        exact: boolean,
        count: number,
        minScore: number,
        showMessages?: boolean,
    ) {
        const index = await context.podcastMemory.conversation.getEntityIndex();
        const matches = await knowLib.searchIndex(
            name ? index.nameIndex : index.typeIndex,
            query,
            exact,
            count,
            minScore,
        );
        for (const match of matches) {
            context.printer.writeInColor(chalk.green, `[${match.score}]`);
            await writeEntitiesById(index, match.item, showMessages);
        }
    }

    async function searchEntities_Multi(
        name: string | undefined,
        type: string | undefined,
        facet: string | undefined,
        count: number,
        faceCount: number,
        minScore: number,
        showMessages?: boolean,
    ) {
        const index = await context.podcastMemory.conversation.getEntityIndex();
        let nameMatches: string[] | undefined;
        let typeMatches: string[] | undefined;
        let facetMatches: string[] | undefined;
        if (name) {
            nameMatches = await index.nameIndex.getNearest(
                name,
                count,
                minScore,
            );
        }
        if (type) {
            typeMatches = await index.typeIndex.getNearest(
                type,
                count,
                minScore,
            );
        }
        if (facet) {
            facetMatches = await index.facetIndex.getNearest(
                facet,
                faceCount,
                minScore,
            );
        }
        const matches = [
            ...knowLib.sets.intersectMultiple(
                nameMatches,
                typeMatches,
                facetMatches,
            ),
        ];
        await writeEntitiesById(index, matches, showMessages);
    }

    function podcastEntitiesDef(): CommandMetadata {
        return {
            description: "Search for podcast entities",
            options: {
                name: arg("Names to search for"),
                type: arg("Type to search for"),
                facet: arg("Facet to search for"),
                exact: argBool("Exact match?"),
                count: argNum("Num matches", 1),
                facetCount: argNum("Num facet matches", 10),
                minScore: argNum("Min score", 0),
                showMessages: argBool(),
            },
        };
    }
    commands.podcastEntities.metadata = podcastEntitiesDef();
    // Same as @entities but for the podcast index.
    async function podcastEntities(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, podcastEntitiesDef());
        let query = namedArgs.name ?? namedArgs.type ?? namedArgs.facet;
        if (query) {
            const isMultipart =
                namedArgs.facet || (namedArgs.name && namedArgs.type);
            if (namedArgs.exact || !isMultipart) {
                await searchEntities(
                    query,
                    namedArgs.name !== undefined,
                    namedArgs.exact,
                    namedArgs.count,
                    namedArgs.minScore,
                    namedArgs.showMessages,
                );
            } else {
                // Multipart query
                await searchEntities_Multi(
                    namedArgs.name,
                    namedArgs.type,
                    namedArgs.facet,
                    namedArgs.count,
                    namedArgs.facetCount,
                    namedArgs.minScore,
                    namedArgs.showMessages,
                );
            }
            return;
        }

        const index = await context.podcastMemory.conversation.getEntityIndex();
        const entityArray = await asyncArray.toArray(index.entities());
        const entities = [...conversation.toCompositeEntities(entityArray)];
        entities.sort((x, y) => x.name.localeCompare(y.name));
        let printer = context.printer;
        printer.writeCompositeEntities(entities);
    }

    function recordQuestionAnswer(
        question: string,
        timestampQ: Date,
        answer: string,
        timestampA: Date,
    ) {
        // Don't record questions about the search history
        if (
            context.searchMemory &&
            context.searchMemory.conversationName !== context.conversationName
        ) {
            try {
                context.searchMemory.queueAddMessage({
                    text: `USER:\n${question}`,
                    timestamp: timestampQ,
                });
                context.searchMemory.queueAddMessage({
                    text: `ASSISTANT:\n${answer}`,
                    timestamp: timestampA,
                });
            } catch (e) {
                context.printer.writeError(`Error updating history\n${e}`);
            }
        }
    }

    async function searchConversation(
        searcher: conversation.ConversationSearchProcessor,
        recordAnswer: boolean,
        namedArgs: NamedArgs,
    ): Promise<conversation.SearchResponse | undefined> {
        const maxMatches = namedArgs.maxMatches;
        const minScore = namedArgs.minScore;
        let query = namedArgs.query.trim();
        if (!query || query.length === 0) {
            return undefined;
        }
        const searchOptions: conversation.SearchProcessingOptions = {
            maxMatches,
            minScore,
            maxMessages: 10,
            progress: (value) => context.printer.writeJson(value),
        };
        if (namedArgs.fallback) {
            searchOptions.fallbackSearch = { maxMatches: 10 };
        }
        if (namedArgs.threads) {
            searchOptions.threadSearch = { maxMatches: 1, minScore: 0.8 };
        }
        if (!namedArgs.eval) {
            // just translate user query into structured query without eval
            const translationContext = await context.searcher.buildContext(
                query,
                searchOptions,
            );
            const searchResult: any = namedArgs.v2
                ? await searcher.actions.translateSearchTermsV2(
                      query,
                      translationContext,
                  )
                : await context.searcher.actions.translateSearch(
                      query,
                      translationContext,
                  );
            context.printer.writeJson(searchResult);
            return undefined;
        }

        searcher.answers.settings.chunking.enable = true; //namedArgs.chunk === true;

        const timestampQ = new Date();
        let result:
            | conversation.SearchTermsActionResponse
            | conversation.SearchTermsActionResponseV2
            | undefined;
        if (namedArgs.v2) {
            searchOptions.skipEntitySearch = namedArgs.skipEntities;
            searchOptions.skipActionSearch = namedArgs.skipActions;
            searchOptions.skipTopicSearch = namedArgs.skipTopics;
            result = await searcher.searchTermsV2(
                query,
                undefined,
                searchOptions,
            );
        } else {
            result = await searcher.searchTerms(
                query,
                undefined,
                searchOptions,
            );
        }
        if (!result) {
            context.printer.writeError("No result");
            return undefined;
        }
        context.printer.writeLine();
        context.printer.writeSearchTermsResult(result, namedArgs.debug);
        if (result.response && result.response.answer) {
            if (namedArgs.save && recordAnswer) {
                let answer = result.response.answer.answer;
                if (!answer) {
                    answer = result.response.answer.whyNoAnswer;
                }
                if (answer) {
                    recordQuestionAnswer(query, timestampQ, answer, new Date());
                }
            }
        }
        return result.response;
    }

    function podcastSearchDefBase(): CommandMetadata {
        return {
            description: "Natural language search on a podcast",
            args: {
                query: arg("Search query"),
            },
            options: {
                maxMatches: argNum("Maximum fuzzy matches", 2),
                minScore: argNum("Minimum similarity score", 0.8),
                fallback: argBool("Fallback to message search", true),
                eval: argBool("Evaluate search query", true),
                debug: argBool("Show debug info", false),
                save: argBool("Save the search", false),
                v2: argBool("Run V2 match", false),
                chunk: argBool("Use chunking", true),
            },
        };
    }

    function podcastSearchDef(): CommandMetadata {
        const def = podcastSearchDefBase();
        if (!def.options) {
            def.options = {};
        }
        def.options.skipEntities = argBool("Skip entity matching", false);
        def.options.skipActions = argBool("Skip action matching", false);
        def.options.skipTopics = argBool("Skip topics matching", false);
        def.options.threads = argBool("Use most likely thread", false);
        return def;
    }
    // Just supports query for now
    commands.search.metadata = podcastSearchDef();
    async function podcastSearch(
        args: string[],
        io: InteractiveIo,
    ): Promise<void> {
        await searchConversation(
            context.podcastMemory.searchProcessor,
            true,
            parseNamedArguments(args, podcastSearchDef()),
        );
    }

    function podcastConvertDef(): CommandMetadata {
        return {
            description: "Parse a podcast transcript into turns and save them.",
            args: {
                sourcePath: argSourceFileOrFolder(),
            },
            options: {
                startAt: arg("Start date and time"),
                length: argNum("Length of the podcast in minutes", 60),
            },
        };
    }
    commands.podcastConvert.metadata = podcastConvertDef();
    async function podcastConvert(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, podcastConvertDef());
        const sourcePath = namedArgs.sourcePath;
        const startAt = argToDate(namedArgs.startAt);
        const endAt = startAt
            ? dateTime.addMinutesToDate(startAt, namedArgs.length)
            : undefined;
        await importTranscript(sourcePath, startAt, endAt);
    }

    function podcastIndexDef(): CommandMetadata {
        return {
            description: "Import podcast turns from a folder",
            args: {
                sourcePath: argSourceFileOrFolder(),
            },
            options: {
                clean: argClean(),
                maxTurns: argNum("Max turns"),
                pauseMs: argPause(1000),
            },
        };
    }
    commands.podcastIndex.metadata = podcastIndexDef();
    async function podcastIndex(args: string[] | NamedArgs) {
        const namedArgs = parseNamedArguments(args, podcastIndexDef());
        let sourcePath: string = namedArgs.sourcePath;
        let isDir = isDirectoryPath(sourcePath);
        if (isDir) {
            await indexTurns(
                sourcePath,
                namedArgs.maxItems ?? Number.MAX_SAFE_INTEGER,
                namedArgs.pauseMs,
                namedArgs.clean,
            );
        } else {
            context.printer.writeError(`${sourcePath} is not a directory`);
        }
    }

    function podcastAddThreadDef(): CommandMetadata {
        return {
            description: "Add a sub-thread to the podcast index",
            args: {
                sourcePath: argSourceFileOrFolder(),
                name: arg("Thread name"),
                description: arg("Thread description"),
            },
            options: {
                startAt: arg("Start date and time"),
                length: argNum("Length of the podcast in minutes", 60),
            },
        };
    }
    commands.podcastAddThread.metadata = podcastAddThreadDef();
    async function podcastAddThread(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, podcastConvertDef());
        const sourcePath = namedArgs.sourcePath;
        const timeRange = conversation.parseTranscriptDuration(
            namedArgs.startAt,
            namedArgs.length,
        );
        if (!timeRange) {
            context.printer.writeError("Time range required");
            return;
        }
        const turns =
            await conversation.loadTurnsFromTranscriptFile(sourcePath);
        const metadata: conversation.TranscriptMetadata = {
            sourcePath,
            name: namedArgs.name,
            description: namedArgs.description,
            startAt: namedArgs.startAt,
            lengthMinutes: namedArgs.length,
        };
        const overview = conversation.createTranscriptOverview(metadata, turns);
        const threadDef: conversation.ThreadTimeRange = {
            type: "temporal",
            description: overview,
            timeRange,
        };
        const threads =
            await context.podcastMemory.conversation.getThreadIndex();
        await threads.add(threadDef);
        writeThread(threadDef);
    }
    commands.podcastList.metadata = "List all registered threads";
    async function podcastListThreads(args: string[]) {
        const threads =
            await context.podcastMemory.conversation.getThreadIndex();
        const allThreads: NameValue<conversation.ConversationThread>[] =
            await asyncArray.toArray(threads.entries());
        for (let i = 0; i < allThreads.length; ++i) {
            const t = allThreads[i];
            context.printer.writeLine(`[${i + 1}] Id: ${t.name}`);
            const tags = await threads.tagIndex.getTagsFor(t.name);
            writeThread(t.value, tags);
        }
    }

    function podcastAddThreadTagDef(): CommandMetadata {
        return {
            description: "Add tags for a sub-thread to the podcast index",
            args: {
                threadId: arg("Thread Id"),
            },
            options: {
                name: arg("name"),
                tag: arg("Tag"),
            },
        };
    }
    commands.podcastAddThreadTag.metadata = podcastAddThreadTagDef();
    async function podcastAddThreadTag(args: string[]) {
        const namedArgs = parseNamedArguments(args, podcastAddThreadTagDef());
        const threadIndex =
            await context.podcastMemory.conversation.getThreadIndex();
        const threadId = namedArgs.threadId;
        const thread = await threadIndex.getById(threadId);
        if (thread) {
            const tags: string[] = [];
            if (namedArgs.name) {
                const pName = conversation.splitParticipantName(namedArgs.name);
                if (pName) {
                    tags.push(pName.firstName);
                    tags.push(namedArgs.name);
                }
            }
            if (namedArgs.tag) {
                tags.push(namedArgs.tag);
            }
            if (tags && tags.length > 0) {
                context.printer.writeLine(
                    `Adding tags to: ${thread.description}\n---`,
                );
                for (const tag of tags) {
                    context.printer.writeLine(tag);
                    await threadIndex.tagIndex.addTag(tag, threadId);
                }
            }
        } else {
            context.printer.writeLine("Thread not found");
        }
    }

    function podcastRemoveThreadTagDef(): CommandMetadata {
        return {
            description: "Remove tags for a sub-thread to the podcast index",
            args: {
                threadId: arg("Thread Id"),
                tag: arg("Tag"),
            },
        };
    }
    commands.podcastRemoveThreadTag.metadata = podcastRemoveThreadTagDef();
    async function podcastRemoveThreadTag(args: string[]) {
        const namedArgs = parseNamedArguments(
            args,
            podcastRemoveThreadTagDef(),
        );
        const threadIndex =
            await context.podcastMemory.conversation.getThreadIndex();
        const threadId = namedArgs.threadId;
        const thread = await threadIndex.getById(threadId);
        if (thread) {
            context.printer.writeLine(
                `Remove tag ${namedArgs.tag} from: ${thread.description}\n---`,
            );
            await threadIndex.tagIndex.removeTag(namedArgs.tag, threadId);
        } else {
            context.printer.writeLine("Thread not found");
        }
    }

    function podcastAliasDef(): CommandMetadata {
        return {
            description: "Add an alias for a participants's name",
            options: {
                name: arg("Person's name"),
                alias: arg("Alias"),
            },
        };
    }
    commands.podcastAlias.metadata = podcastAliasDef();
    async function podcastAlias(args: string[]) {
        const namedArgs = parseNamedArguments(args, podcastAliasDef());
        await manageConversationAlias(
            context.podcastMemory,
            context.printer,
            namedArgs.name,
            namedArgs.alias,
        );
    }

    return;

    //---
    // END Commands
    //--

    async function indexTurns(
        sourcePath: string,
        maxItems: number,
        pauseMs?: number,
        clean?: boolean,
    ) {
        if (!sourcePath.endsWith("turns")) {
            sourcePath = path.join(sourcePath, "turns");
        }
        context.printer.writeInColor(chalk.cyan, "Adding turns to memory");
        if (clean) {
            await context.podcastMemory.clear(true);
        }
        const queue = await createWorkQueueFolder(
            path.dirname(sourcePath),
            path.basename(sourcePath),
        );
        await runImportQueue(
            queue,
            getStatsFilePath(),
            clean ?? false,
            maxItems,
            pauseMs ?? 0,
            context.printer,
            async (filePath) => {
                const turn = await conversation.loadTranscriptTurn(filePath);
                if (turn) {
                    const turnCharsLength = turn.speech.value.length;
                    context.printer.writeLine(
                        `${filePath}\n${turnCharsLength} chars`,
                    );

                    await conversation.addTranscriptTurnsToConversation(
                        context.podcastMemory,
                        turn,
                    );
                    return turnCharsLength;
                }
                return 0;
            },
        );
    }

    async function importTranscript(
        sourcePath: string,
        startAt?: Date | undefined,
        endAt?: Date | undefined,
    ) {
        const turns =
            await conversation.loadTurnsFromTranscriptFile(sourcePath);
        if (startAt && endAt) {
            conversation.timestampTranscriptTurns(turns, startAt, endAt);
        }
        const transcriptFileName = getFileName(sourcePath);
        await removeDir(
            path.join(path.dirname(sourcePath), transcriptFileName),
        );
        const turnsFolderPath = getTurnsFolderPath(sourcePath);
        context.printer.writeLine(
            `Saving ${turns.length} turns to ${turnsFolderPath}`,
        );
        await conversation.saveTranscriptTurnsToFolder(
            turnsFolderPath,
            transcriptFileName,
            turns,
        );
    }

    function getTurnsFolderPath(transcriptFilePath: string) {
        const transcriptFileName = getFileName(transcriptFilePath);
        const turnsFolderPath = path.join(
            path.dirname(transcriptFilePath),
            transcriptFileName,
            "turns",
        );
        return turnsFolderPath;
    }

    function getStatsFilePath() {
        return path.join(
            context.statsPath,
            `${context.podcastMemory.conversationName}_stats.json`,
        );
    }

    function writeThread(
        t: conversation.ConversationThread,
        tags: string[] | undefined = undefined,
    ) {
        context.printer.writeLine(t.description);
        const range = conversation.toDateRange(t.timeRange);
        context.printer.writeLine(range.startDate.toISOString());
        context.printer.writeLine(range.stopDate!.toISOString());
        if (tags && tags.length > 0) {
            context.printer.writeLine("Tags: " + tags.join(", "));
        }
        context.printer.writeLine();
    }

    /*
    async function writeEntities(
        entityIndex: conversation.EntityIndex,
        entityIds: string[] | undefined,
    ) {
        if (entityIds && entityIds.length > 0) {
            context.printer.writeInColor(
                chalk.green,
                `### ${entityIds.length} entities ###`,
            );
            const entities = await entityIndex.getMultiple(entityIds);
            context.printer.writeCompositeEntities([
                ...conversation.toCompositeEntities(entities),
            ]);
            context.printer.writeInColor(
                chalk.green,
                `### ${entityIds.length} entities ###`,
            );
        } else {
            context.printer.writeLine("No entities");
        }
    }*/
}

function podcastMessageFromEmailText(text: string) {
    let messageText = "";
    let speaker: string | undefined;
    let lines = knowLib.splitIntoLines(text);
    for (let line of lines) {
        if (line.startsWith("From: ")) {
            speaker = line.replace("From: ", "");
        } else if (line.startsWith(`"From: `)) {
            speaker = line.replace(`"From: `, "");
        } else if (!line.startsWith("To: ")) {
            messageText += line;
            messageText += "\n";
        }
    }
    return new cm.PodcastMessage(
        [messageText],
        new cm.PodcastMessageMeta(speaker),
    );
}

function extractedKnowledgeToResponse(
    extractedKnowledge: conversation.ExtractedKnowledge | undefined,
): conversation.KnowledgeResponse {
    if (extractedKnowledge) {
        const entities: conversation.ConcreteEntity[] =
            extractedKnowledge.entities?.map((e) => e.value) ?? [];
        const actions: conversation.Action[] =
            extractedKnowledge.actions?.map((a) => a.value) ?? [];
        const topics: conversation.Topic[] =
            extractedKnowledge.topics?.map((t) => t.value) ?? [];
        return {
            entities,
            actions,
            topics,
            inverseActions: [],
        };
    }
    return {
        entities: [],
        actions: [],
        topics: [],
        inverseActions: [],
    };
}
