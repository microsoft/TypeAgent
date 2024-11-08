// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import * as knowLib from "knowledge-processor";
import { conversation } from "knowledge-processor";
import { ChatModel } from "aiclient";
import { sqlite } from "memory-providers";
import { ChatContext, ReservedConversationNames } from "./chatMemory.js";
import { collections, ensureDir, isDirectoryPath } from "typeagent";
import {
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
    NamedArgs,
    parseNamedArguments,
    StopWatch,
} from "interactive-app";
import {
    argChunkSize,
    argClean,
    argConcurrency,
    argSourceFileOrFolder,
} from "./common.js";
import chalk from "chalk";
import { importMsgFiles } from "./importer.js";

export async function createEmailMemory(
    chatModel: ChatModel,
    storePath: string,
    settings: conversation.ConversationSettings,
    useSqlite: boolean = false,
    createNew: boolean = false,
) {
    const emailStorePath = path.join(
        storePath,
        ReservedConversationNames.outlook,
    );
    await ensureDir(emailStorePath);
    const storage = useSqlite
        ? await sqlite.createStorageDb(emailStorePath, "outlook.db", createNew)
        : undefined;

    return await knowLib.email.createEmailMemory(
        chatModel,
        ReservedConversationNames.outlook,
        storePath,
        settings,
        storage,
    );
}

export function createEmailCommands(
    context: ChatContext,
    commands: Record<string, CommandHandler>,
): void {
    commands.importEmail = importEmail;

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
                concurrency: argConcurrency(2),
                clean: argClean(),
                chunkSize: argChunkSize(context.maxCharsPerChunk),
                maxMessages: argNum("Max messages"),
                index: argBool("Index imported files", true),
            },
        };
    }
    commands.importEmail.metadata = importEmailDef();
    async function importEmail(args: string[], io: InteractiveIo) {
        const namedArgs = parseNamedArguments(args, importEmailDef());
        let sourcePath: string = namedArgs.sourcePath;
        let isDir = isDirectoryPath(sourcePath);
        let isJson = sourcePath.endsWith("json");
        if (isDir && !isJson) {
            context.printer.writeInColor(
                chalk.cyan,
                "Converting message files",
            );
            await importMsgFiles(sourcePath, io);
            sourcePath = path.join(sourcePath, "json");
        }
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

    //-------------
    // End commands
    //-------------

    async function indexEmails(namedArgs: NamedArgs, sourcePath: string) {
        context.printer.writeInColor(chalk.cyan, "Adding emails to memory");
        if (namedArgs.clean) {
            await context.emailMemory.clear(true);
        }
        let emails = await knowLib.email.loadEmailFolder(
            sourcePath,
            namedArgs.concurrency,
        );
        if (namedArgs.maxMessages && namedArgs.maxMessages > 0) {
            emails = emails.slice(0, namedArgs.maxMessages);
        }
        let i = 0;
        const clock = new StopWatch();
        let totalMs = 0;
        for (const emailBatch of collections.slices(
            emails,
            namedArgs.concurrency,
        )) {
            ++i;
            context.printer.writeBatchProgress(
                emailBatch,
                undefined,
                emails.length,
            );
            emailBatch.value.forEach((e) =>
                context.printer.writeLine(
                    `${e.sourcePath}\n${knowLib.email.emailToString(e).length} chars`,
                ),
            );
            clock.start();
            await knowLib.email.addEmailToConversation(
                context.emailMemory,
                emailBatch.value,
                namedArgs.chunkSize,
            );
            clock.stop();
            totalMs += clock.elapsedMs;
            context.printer.writeTiming(chalk.green, clock);
        }
        context.printer.writeInColor(
            chalk.grey,
            `${totalMs / (1000 * 60)} minutes`,
        );
    }
}
