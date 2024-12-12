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
} from "./common.js";
import path from "path";
import {
    createWorkQueueFolder,
    ensureDir,
    getFileName,
    isDirectoryPath,
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
    cm.searchProcessor.answers.settings.chunking.fastStop = true;
    return cm;
}

export function createPodcastCommands(
    context: ChatContext,
    commands: Record<string, CommandHandler>,
): void {
    commands.podcastConvert = podcastConvert;
    commands.importPodcast = importPodcast;
    //-----------
    // COMMANDS
    //---------
    function podcastParseDef(): CommandMetadata {
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
    commands.podcastConvert.metadata = podcastParseDef();
    async function podcastConvert(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, podcastParseDef());
        const sourcePath = namedArgs.sourcePath;
        const startAt = argToDate(namedArgs.startAt);
        const endAt = startAt
            ? addMinutesToDate(startAt, namedArgs.length)
            : undefined;
        await importTranscript(sourcePath, startAt, endAt);
    }

    function importPodcastDef(): CommandMetadata {
        return {
            description: "Import podcast turns from a folder",
            args: {
                sourcePath: argSourceFileOrFolder(),
            },
            options: {
                clean: argClean(),
                maxTurns: argNum("Max turns"),
                pauseMs: argPause(),
            },
        };
    }
    commands.importPodcast.metadata = importPodcastDef();
    async function importPodcast(args: string[]) {
        const namedArgs = parseNamedArguments(args, importPodcastDef());
        let sourcePath: string = namedArgs.sourcePath;
        let isDir = isDirectoryPath(sourcePath);
        if (isDir) {
            await indexTurns(namedArgs, sourcePath);
        } else {
            context.printer.writeLine("Individual files not supported yet.");
        }
    }
    return;

    //---
    // END Commands
    //--

    async function indexTurns(namedArgs: NamedArgs, sourcePath: string) {
        if (!sourcePath.endsWith("turns")) {
            sourcePath = path.join(sourcePath, "turns");
        }
        context.printer.writeInColor(chalk.cyan, "Adding turns to memory");
        if (namedArgs.clean) {
            await context.podcastMemory.clear(true);
        }
        const queue = await createWorkQueueFolder(
            path.dirname(sourcePath),
            path.basename(sourcePath),
        );
        const maxItems = namedArgs.maxItems ?? Number.MAX_SAFE_INTEGER;
        await runImportQueue(
            queue,
            getStatsFilePath(),
            namedArgs.clean,
            maxItems,
            namedArgs.pauseMs,
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
        const destFolderPath = path.join(
            path.dirname(sourcePath),
            transcriptFileName,
            "turns",
        );
        context.printer.writeLine(
            `Saving ${turns.length} turns to ${destFolderPath}`,
        );
        await conversation.saveTranscriptTurns(
            destFolderPath,
            transcriptFileName,
            turns,
        );
    }

    function getStatsFilePath() {
        return path.join(
            context.statsPath,
            `${context.podcastMemory.conversationName}_stats.json`,
        );
    }
}
