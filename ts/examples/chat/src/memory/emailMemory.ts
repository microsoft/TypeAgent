// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import * as knowLib from "knowledge-processor";
import { conversation } from "knowledge-processor";
import { sqlite } from "memory-providers";
import {
    ChatContext,
    Models,
    ReservedConversationNames,
} from "./chatMemory.js";
import {
    createWorkQueueFolder,
    dateTime,
    ensureDir,
    isDirectoryPath,
    readJsonFile,
    removeFile,
    writeJsonFile,
} from "typeagent";
import {
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
    millisecondsToString,
    NamedArgs,
    parseNamedArguments,
    StopWatch,
} from "interactive-app";
import {
    argChunkSize,
    argClean,
    argConcurrency,
    argPause,
    argSourceFileOrFolder,
} from "./common.js";
import chalk from "chalk";
import { convertMsgFiles } from "./importer.js";

export async function createEmailMemory(
    models: Models,
    storePath: string,
    settings: conversation.ConversationSettings,
    useSqlite: boolean = false,
    createNew: boolean = false,
) {
    const emailSettings: conversation.ConversationSettings = {
        ...settings,
    };
    if (models.embeddingModelSmall) {
        emailSettings.entityIndexSettings = {
            ...settings.indexSettings,
        };
        emailSettings.entityIndexSettings.embeddingModel =
            models.embeddingModelSmall;
        emailSettings.actionIndexSettings = {
            ...settings.indexSettings,
        };
        emailSettings.actionIndexSettings.embeddingModel =
            models.embeddingModelSmall;
    }
    const emailStorePath = path.join(
        storePath,
        ReservedConversationNames.outlook,
    );
    await ensureDir(emailStorePath);
    const storage = useSqlite
        ? await sqlite.createStorageDb(emailStorePath, "outlook.db", createNew)
        : undefined;

    return await knowLib.email.createEmailMemory(
        models.chatModel,
        ReservedConversationNames.outlook,
        storePath,
        emailSettings,
        storage,
    );
}

export function createEmailCommands(
    context: ChatContext,
    commands: Record<string, CommandHandler>,
): void {
    commands.importEmail = importEmail;
    commands.convertMsg = convertMsgs;
    commands.emailStats = emailStats;

    //--------
    // Commands
    //---------
    function importEmailDef(): CommandMetadata {
        return {
            description: "Import emails in a folder",
            args: {
                sourcePath: argSourceFileOrFolder(),
            },
            options: {
                concurrency: argConcurrency(1),
                clean: argClean(),
                chunkSize: argChunkSize(context.maxCharsPerChunk),
                maxMessages: argNum("Max messages", 25),
                index: argBool("Index imported files", true),
                pause: argPause(),
            },
        };
    }
    commands.importEmail.metadata = importEmailDef();
    async function importEmail(args: string[], io: InteractiveIo) {
        const namedArgs = parseNamedArguments(args, importEmailDef());
        let sourcePath: string = namedArgs.sourcePath;
        let isDir = isDirectoryPath(sourcePath);
        let isJson = sourcePath.endsWith("json");
        if (namedArgs.index) {
            if (isDir) {
                await indexEmails(namedArgs, sourcePath);
            } else if (isJson) {
                if (
                    !(await knowLib.email.addEmailFileToConversation(
                        context.emailMemory,
                        sourcePath,
                        namedArgs.chunkSize,
                    ))
                ) {
                    context.printer.writeLine(`Could not load ${sourcePath}`);
                }
            }
        }
    }

    function convertMsgsDef(): CommandMetadata {
        return {
            description: "Convert msg files in a folder",
            args: {
                sourcePath: argSourceFileOrFolder(),
            },
        };
    }
    async function convertMsgs(
        args: string[],
        io: InteractiveIo,
    ): Promise<void> {
        const namedArgs = parseNamedArguments(args, convertMsgsDef());
        let sourcePath: string = namedArgs.sourcePath;
        let isDir = isDirectoryPath(sourcePath);
        if (isDir) {
            context.printer.writeInColor(
                chalk.cyan,
                "Converting message files",
            );
            await convertMsgFiles(sourcePath, io);
        }
    }

    commands.emailStats.metadata = "Email statistics";
    async function emailStats(args: string[]): Promise<void> {
        const stats = await loadStats(false);
        context.printer.writeBullet(`Email count: ${stats.itemStats.length}`);
        context.printer.writeBullet(
            `Total chars: ${stats.totalStats.charCount}`,
        );
    }

    //-------------
    // End commands
    //-------------
    async function indexEmails(namedArgs: NamedArgs, sourcePath: string) {
        if (!sourcePath.endsWith("json")) {
            sourcePath = path.join(sourcePath, "json");
        }
        context.printer.writeInColor(chalk.cyan, "Adding emails to memory");
        if (namedArgs.clean) {
            await context.emailMemory.clear(true);
        }
        const queue = await createWorkQueueFolder(
            path.dirname(sourcePath),
            path.basename(sourcePath),
            getNamesOfNewestEmails,
        );
        queue.onError = (err) => context.printer.writeError(err);

        context.stats = await loadStats(namedArgs.clean);
        let attempts = 1;
        const clock = new StopWatch();
        const maxAttempts = 2;
        let maxMessages = namedArgs.maxMessages;
        let grandTotal = context.stats.itemStats.length;
        while (attempts <= maxAttempts) {
            const successCount = await queue.drain(
                namedArgs.concurrency,
                namedArgs.concurrency,
                async (filePath, index, total) => {
                    context.printer.writeProgress(index + 1, total);

                    let email = await knowLib.email.loadEmailFile(filePath);
                    const emailLength = email!.body.length;
                    context.printer.writeLine(
                        `${email!.sourcePath}\n${emailLength} chars`,
                    );

                    context.stats.startItem();
                    clock.start();
                    await knowLib.email.addEmailToConversation(
                        context.emailMemory,
                        email!,
                        namedArgs.chunkSize,
                    );
                    clock.stop();
                    context.stats.updateCurrent(clock.elapsedMs, emailLength);
                    await saveStats();

                    grandTotal++;
                    const status = `[${clock.elapsedString()}, ${millisecondsToString(context.stats.totalStats.timeMs, "m")} for ${grandTotal} msgs.]`;

                    context.printer.writeInColor(chalk.green, status);
                    context.printer.writeLine();
                },
                maxMessages,
            );
            // Replay any errors
            if (!(await queue.requeueErrors())) {
                break;
            }
            if (maxMessages) {
                maxMessages -= successCount;
            }
            ++attempts;
            if (attempts <= maxAttempts) {
                context.printer.writeHeading("Retrying errors");
            }
        }
        context.printer.writeHeading("Indexing Stats");
        context.printer.writeIndexingStats(context.stats);
    }

    async function loadStats(clean: boolean): Promise<knowLib.IndexingStats> {
        const statsFilePath = getStatsFilePath();
        let stats: knowLib.IndexingStats | undefined;
        if (clean) {
            await removeFile(statsFilePath);
        } else {
            stats = await readJsonFile<knowLib.IndexingStats>(statsFilePath);
        }
        return knowLib.createIndexingStats(stats);
    }

    async function saveStats() {
        await writeJsonFile(getStatsFilePath(), context.stats);
    }

    function getStatsFilePath() {
        return path.join(
            context.statsPath,
            `${context.emailMemory.conversationName}_stats.json`,
        );
    }

    async function getNamesOfNewestEmails(
        rootPath: string,
        fileNames: string[],
    ): Promise<string[]> {
        let timestampedNames: dateTime.Timestamped<string>[] = [];
        for (const fileName of fileNames) {
            const filePath = path.join(rootPath, fileName);
            const email = await knowLib.email.loadEmailFile(filePath);
            if (email && email.sentOn) {
                const timestamp =
                    dateTime.stringToDate(email.sentOn) ?? new Date();
                timestampedNames.push({ value: fileName, timestamp });
            }
        }
        timestampedNames.sort(
            (x, y) => y.timestamp.getTime() - x.timestamp.getTime(),
        );
        return timestampedNames.map((t) => t.value);
    }
}
