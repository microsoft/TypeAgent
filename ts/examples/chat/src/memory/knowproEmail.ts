// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    argBool,
    CommandHandler,
    CommandMetadata,
    NamedArgs,
    parseNamedArguments,
    ProgressBar,
    StopWatch,
} from "interactive-app";
import { KnowProContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as cm from "conversation-memory";
import path from "path";
import { ensureDir, getFileName, isFilePath } from "typeagent";
import {
    createIndexingEventHandler,
    memoryNameToIndexPath,
} from "./knowproCommon.js";
import chalk from "chalk";

export type KnowProEmailContext = {
    printer: KnowProPrinter;
    email?: cm.EmailMemory | undefined;
    basePath: string;
};

export async function createKnowproEmailCommands(
    kpContext: KnowProContext,
    commands: Record<string, CommandHandler>,
): Promise<void> {
    const context: KnowProEmailContext = {
        printer: kpContext.printer,
        basePath: path.join(kpContext.basePath, "email"),
    };
    await ensureDir(context.basePath);

    commands.kpEmailAdd = emailAdd;
    commands.kpEmailsLoad = emailsLoad;
    commands.kpEmailsBuildIndex = emailsBuildIndex;

    function emailAddDef(): CommandMetadata {
        return {
            description:
                "Add a new email or emails to the current email memory",
            args: {
                filePath: arg("Email file or folder to add"),
            },
            options: {
                updateIndex: argBool("Automatically update index", true),
            },
        };
    }
    commands.kpEmailAdd.metadata = emailAddDef();
    async function emailAdd(args: string[]) {
        const emailMemory = ensureMemoryLoaded();
        if (!emailMemory) {
            return;
        }
        const namedArgs = parseNamedArguments(args, emailAddDef());
        let emailsToAdd: cm.EmailMessage[] = [];
        if (isFilePath(namedArgs.filePath)) {
            const emailMessage = cm.loadEmailMessageFromFile(
                namedArgs.filePath,
            );
            if (emailMessage) {
                emailsToAdd.push(emailMessage);
            }
        } else {
            emailsToAdd = cm.loadEmailMessagesFromDir(namedArgs.filePath);
        }
        if (emailsToAdd.length === 0) {
            context.printer.writeError(
                `No loadable emails found in ${namedArgs.filePath}`,
            );
            return;
        }
        context.printer.writeLine(`Adding ${emailsToAdd.length} messages`);
        let progress = new ProgressBar(context.printer, 1);
        const eventHandler = createIndexingEventHandler(
            context.printer,
            progress,
            emailsToAdd.length,
        );
        const result = await emailMemory.addMessages(
            emailsToAdd,
            namedArgs.updateIndex,
            eventHandler,
        );
        progress.complete();
        if (!result.success) {
            context.printer.writeError(result.message);
            return;
        }
    }

    function emailsBuildIndexDef(): CommandMetadata {
        return {
            description: "Update the email index with any pending items",
        };
    }
    commands.kpEmailsBuildIndex.metadata = emailsBuildIndexDef();
    async function emailsBuildIndex(args: string[] | NamedArgs): Promise<void> {
        const emailMemory = ensureMemoryLoaded();
        if (!emailMemory) {
            return;
        }
        context.printer.writeLine(`Building email index`);
        context.printer.writeLine(
            `OrdinalStartAt: ${emailMemory.indexingState.lastMessageOrdinal + 1}`,
        );

        let progress = new ProgressBar(context.printer, 1);
        const eventHandler = createIndexingEventHandler(
            context.printer,
            progress,
            1,
        );
        const clock = new StopWatch();
        clock.start();
        const result = await emailMemory.buildIndex(eventHandler);
        clock.stop();
        progress.complete();
        context.printer.writeTiming(chalk.gray, clock, "Build index");
        if (!result.success) {
            context.printer.writeError(result.message);
            return;
        }
    }

    function loadEmailsDef(): CommandMetadata {
        return {
            description: "Load or Create Email Memory",
            options: {
                //filePath: argDestFile("Path to email index"),
                name: arg("Name of email memory"),
                createNew: argBool("Create new", false),
            },
        };
    }
    commands.kpEmailsLoad.metadata = loadEmailsDef();
    async function emailsLoad(args: string[]) {
        const namedArgs = parseNamedArguments(args, loadEmailsDef());
        let emailIndexPath = namedArgs.filePath;
        emailIndexPath ??= namedArgs.name
            ? memoryNameToIndexPath(context.basePath, namedArgs.name)
            : undefined;
        if (!emailIndexPath) {
            context.printer.writeError("No memory name or path provided");
            return;
        }
        closeEmail();
        context.email = await cm.createEmailMemory(
            {
                dirPath: path.dirname(emailIndexPath),
                baseFileName: getFileName(emailIndexPath),
            },
            namedArgs.createNew,
        );
        if (!context.email) {
            // Memory not found. Create a new one
            context.email = await cm.createEmailMemory(
                {
                    dirPath: path.dirname(emailIndexPath),
                    baseFileName: getFileName(emailIndexPath),
                },
                true,
            );
            if (!context.email) {
                context.printer.writeError("Could not create new email memory");
                return;
            }
        }
        kpContext.conversation = context.email;
    }

    function ensureMemoryLoaded() {
        if (context.email) {
            return context.email;
        }
        context.printer.writeError("No email memory loaded");
        return undefined;
    }

    function closeEmail() {
        if (context.email) {
            context.email.close();
            context.email = undefined;
        }
    }
    return;
}
