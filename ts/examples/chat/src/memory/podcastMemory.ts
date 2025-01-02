// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation } from "knowledge-processor";
import {
    ChatContext,
    Models,
    ReservedConversationNames,
} from "./chatMemory.js";
import { sqlite } from "memory-providers";
import {
    arg,
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
    manageConversationAlias,
} from "./common.js";
import path from "path";
import {
    asyncArray,
    createWorkQueueFolder,
    ensureDir,
    getFileName,
    isDirectoryPath,
    isFilePath,
    NameValue,
    removeDir,
} from "typeagent";
import { runImportQueue } from "./importer.js";
import chalk from "chalk";

export async function createPodcastMemory(
    models: Models,
    storePath: string,
    settings: conversation.ConversationSettings,
    useSqlite: boolean = false,
    createNew: boolean = false,
) {
    const podcastStorePath = path.join(
        storePath,
        ReservedConversationNames.podcasts,
    );
    await ensureDir(podcastStorePath);
    const storageProvider = useSqlite
        ? await sqlite.createStorageDb(
              podcastStorePath,
              "podcast.db",
              createNew,
          )
        : undefined;
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
    //cm.searchProcessor.settings.defaultEntitySearchOptions.alwaysUseTags = true;
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
    commands.podcastAddThreadTag = podcastAddThreadTag;
    //commands.podcastListThreadEntities = podcastListThreadEntities;
    commands.podcastAlias = podcastAlias;

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
        /*
        await conversation.importTranscript(
            sourcePath,
            namedArgs.name,
            namedArgs.description,
            namedArgs.startAt,
            namedArgs.length,
        );
        */
        await podcastAddThread(namedArgs);
        const turnsFilePath = getTurnsFolderPath(sourcePath);
        namedArgs.sourcePath = turnsFilePath;
        await podcastIndex(namedArgs);
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

    /*
    function podcastAddThreadTagsDef(): CommandMetadata {
        return {
            description: "Add tags for a sub-thread to the podcast index",
            args: {
                sourcePath: argSourceFileOrFolder(),
                startAt: arg("Start date and time"),
                length: argNum("Length of the podcast in minutes", 60),
            },
        };
    }
    commands.podcastAddThreadTags.metadata = podcastAddThreadTagsDef();
    async function podcastAddThreadTags(args: string[]) {
        const namedArgs = parseNamedArguments(args, podcastAddThreadTagsDef());
        const timeRange = conversation.parseTranscriptDuration(
            namedArgs.startAt,
            namedArgs.length,
        );
        const threadTags = conversation.getTranscriptTags(
            await conversation.loadTurnsFromTranscriptFile(
                namedArgs.sourcePath,
            ),
        );
        context.printer.writeTitle(`${threadTags.length} tags:`);
        context.printer.writeList(threadTags);
        context.printer.writeLine();
        const entityIndex =
            await context.podcastMemory.conversation.getEntityIndex();

        const entityIds = await entityIndex.getEntityIdsInTimeRange(
            conversation.toStartDate(timeRange.startDate),
            conversation.toStopDate(timeRange.stopDate),
        );
        await writeEntities(entityIndex, entityIds);
        if (entityIds && entityIds.length > 0) {
            context.printer.writeLine(
                `Adding tags to ${entityIds.length} entities`,
            );
            await asyncArray.forEachAsync(threadTags, 1, async (tag) => {
                await entityIndex.addTag(tag, entityIds);
            });
        }
    }

    function podcastListThreadEntitiesDef() {
        return {
            description: "List tags for a sub-thread to the podcast index",
            args: {
                sourcePath: argSourceFileOrFolder(),
            },
        };
    }
    commands.podcastListThreadEntities.metadata =
        podcastListThreadEntitiesDef();
    async function podcastListThreadEntities(args: string[]) {
        const namedArgs = parseNamedArguments(
            args,
            podcastListThreadEntitiesDef(),
        );
        const threadTags = conversation.getTranscriptTags(
            await conversation.loadTurnsFromTranscriptFile(
                namedArgs.sourcePath,
            ),
        );
        const entityIndex =
            await context.podcastMemory.conversation.getEntityIndex();
        const entityIds = await entityIndex.getByTag(threadTags);
        await writeEntities(entityIndex, entityIds);
    }
    */

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
            context.printer.writeInColor(
                chalk.cyan,
                "Tags: " + tags.join(", "),
            );
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
