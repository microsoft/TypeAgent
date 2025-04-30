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
import { argSourceFile } from "./common.js";
import path from "path";
import { ensureDir, getFileName } from "typeagent";
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
    commands.kpEmailsSave = emailsSave;

    function emailAddDef(): CommandMetadata {
        return {
            description: "Add a new email to the current email memory",
            args: {
                filePath: argSourceFile(),
            },
            options: {
                saveIndex: argBool("Automatically save updated memory", true),
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
        const emailMessage = cm.loadEmailMessageFromFile(namedArgs.filePath);
        if (!emailMessage) {
            context.printer.writeError("File path not found");
            return;
        }
        context.printer.writeLine("Adding message");
        let progress = new ProgressBar(context.printer, 1);
        const eventHandler = createIndexingEventHandler(
            context.printer,
            progress,
            1,
        );
        const result = await emailMemory.addMessage(emailMessage, eventHandler);
        progress.complete();
        if (!result.success) {
            context.printer.writeError(result.message);
            return;
        }
        if (namedArgs.saveIndex) {
            await emailsSave(args);
        }
    }

    function emailsSaveDef(): CommandMetadata {
        return {
            description: "Save current email memory",
        };
    }
    commands.kpEmailsSave.metadata = emailsSaveDef();
    async function emailsSave(args: string[] | NamedArgs): Promise<void> {
        const emailMemory = ensureMemoryLoaded();
        if (!emailMemory) {
            return;
        }
        const namedArgs = parseNamedArguments(args, emailsSaveDef());
        context.printer.writeLine("Saving memory");
        context.printer.writeLine(namedArgs.filePath);
        const dirName = path.dirname(namedArgs.filePath);
        await ensureDir(dirName);

        const clock = new StopWatch();
        clock.start();
        await emailMemory.writeToFile();
        clock.stop();
        context.printer.writeTiming(chalk.gray, clock, "Write to file");
    }

    function loadEmailsDef(): CommandMetadata {
        return {
            description: "Create new Email Memory",
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
