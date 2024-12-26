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
    NamedArgs,
    parseNamedArguments,
} from "interactive-app";
import {
    addMinutesToDate,
    argClean,
    argPause,
    argSourceFileOrFolder,
    argToDate,
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
    removeDir,
} from "typeagent";
import { runImportQueue } from "./importer.js";
import chalk from "chalk";

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
        storageProvider = await elastic.createStorageIndex(
            createNew,
        );
    }
    else if (useSqlite) {
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
    cm.searchProcessor.answers.settings.chunking.fastStop = true;
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
    commands.podcastListThreads = podcastListThreads;
    commands.podcastEntities = podcastEntities;

    //-----------
    // COMMANDS
    //---------
    function importPodcastDef(): CommandMetadata {
        return {
            description: "Import a podcast transcript.",
            args: {
                sourcePath: argSourceFileOrFolder(),
                name: arg("Thread name"),
                description: arg("Thread description"),
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

    // Eventually we should unite these functions with their
    // counterparts in @entities command in chatMemory.ts but 
    // need input.
    async function loadMessages(
        ids?: string[],
    ): Promise<(dateTime.Timestamped<knowLib.TextBlock> | undefined)[]> {
        if (ids && ids.length > 0) {
            return await context.podcastMemory.conversation.messages.getMultiple(ids);
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
        const entities = [
            ...conversation.toCompositeEntities(entityArray),
        ];
        entities.sort((x, y) => x.name.localeCompare(y.name));
        let printer = context.printer;
        printer.writeCompositeEntities(entities);
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
            ? addMinutesToDate(startAt, namedArgs.length)
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
    commands.podcastListThreads.metadata = "List all registered threads";
    async function podcastListThreads(args: string[]) {
        const threads =
            await context.podcastMemory.conversation.getThreadIndex();
        const allThreads: conversation.ConversationThread[] =
            await asyncArray.toArray(threads.entries());
        for (let i = 0; i < allThreads.length; ++i) {
            const t = allThreads[i];
            context.printer.writeLine(`[${i}]`);
            writeThread(t);
        }
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
        await conversation.saveTranscriptTurns(
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

    function writeThread(t: conversation.ConversationThread) {
        context.printer.writeLine(t.description);
        const range = conversation.toDateRange(t.timeRange);
        context.printer.writeLine(range.startDate.toISOString());
        context.printer.writeLine(range.stopDate!.toISOString());
        context.printer.writeLine();
    }
}
