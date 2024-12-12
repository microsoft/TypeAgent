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
    parseNamedArguments,
} from "interactive-app";
import {
    addMinutesToDate,
    argSourceFileOrFolder,
    argToDate,
} from "./common.js";
import path from "path";
import { ensureDir, getFileName, writeJsonFile } from "typeagent";

export async function createPodcastMemory(
    models: Models,
    storePath: string,
    settings: conversation.ConversationSettings,
    useSqlite: boolean = false,
    createNew: boolean = false,
) {
    const storageProvider = useSqlite
        ? await sqlite.createStorageDb(storePath, "podcast.db", createNew)
        : undefined;
    return conversation.createConversationManagerEx(
        {
            model: models.chatModel,
            answerModel: models.answerModel,
        },
        settings,
        ReservedConversationNames.podcasts,
        storePath,
        storageProvider,
    );
}

export function createPodcastCommands(
    context: ChatContext,
    commands: Record<string, CommandHandler>,
): void {
    commands.podcastParse = podcastParse;
    //-----------
    // COMMANDS
    //---------
    function podcastParseDef(): CommandMetadata {
        return {
            description: "Parse a podcast transcript into turns.",
            args: {
                sourcePath: argSourceFileOrFolder(),
            },
            options: {
                startAt: arg("Start date and time"),
                length: argNum("Length of the podcast in minutes", 60),
            },
        };
    }
    commands.podcastParse.metadata = podcastParseDef();
    async function podcastParse(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, podcastParseDef());
        const sourcePath = namedArgs.sourcePath;
        const startAt = argToDate(namedArgs.startAt);
        const endAt = startAt
            ? addMinutesToDate(startAt, namedArgs.length)
            : undefined;
        await importTranscript(sourcePath, startAt, endAt);
    }

    return;
    //---
    // END Commands
    //--
    async function importTranscript(
        sourcePath: string,
        startAt?: Date | undefined,
        endAt?: Date | undefined,
    ) {
        const turns = await conversation.loadTranscriptFile(sourcePath);
        if (startAt && endAt) {
            conversation.timestampTranscriptTurns(turns, startAt, endAt);
        }

        const transcriptFileName = getFileName(sourcePath);
        const destFolderPath = path.join(
            path.dirname(sourcePath),
            `${transcriptFileName}_turns`,
        );
        context.printer.writeLine(
            `Saving ${turns.length} turns to ${destFolderPath}`,
        );
        await ensureDir(destFolderPath);
        for (let i = 0; i < turns.length; ++i) {
            let turnFilePath = path.join(
                destFolderPath,
                `${transcriptFileName}_${i + 1}.json`,
            );
            await writeJsonFile(turnFilePath, turns[i]);
        }
    }
}
