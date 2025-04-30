// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    CommandHandler,
    CommandMetadata,
    parseNamedArguments,
    StopWatch,
} from "interactive-app";
import { KnowProContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as cm from "conversation-memory";
import { argDestFile, argSourceFile } from "./common.js";
import path from "path";
import { ensureDir, getFileName } from "typeagent";
import { memoryNameToIndexPath } from "./knowproCommon.js";
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
            description: "Add a new email to the index",
            args: {
                filePath: argSourceFile(),
            },
        };
    }
    commands.kpEmailAdd.metadata = emailAddDef();
    async function emailAdd(args: string[]) {
        if (!ensureIndexLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(args);
        const emailMessage = cm.loadEmailMessageFromFile(namedArgs.filePath);
        if (!emailMessage) {
            context.printer.writeError("File path not found");
            return;
        }
        await context.email!.addMessage(emailMessage);
    }

    function emailsSaveDef(): CommandMetadata {
        return {
            description: "Save email index",
            args: {
                filePath: argDestFile(),
            },
        };
    }
    commands.emailsSave.metadata = emailsSaveDef();
    async function emailsSave(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, emailsSaveDef());
        if (!context.email) {
            context.printer.writeError("No email index loaded");
            return;
        }
        context.printer.writeLine("Saving index");
        context.printer.writeLine(namedArgs.filePath);
        const dirName = path.dirname(namedArgs.filePath);
        await ensureDir(dirName);

        const clock = new StopWatch();
        clock.start();
        await context.email.writeToFile(
            dirName,
            getFileName(namedArgs.filePath),
        );
        clock.stop();
        context.printer.writeTiming(chalk.gray, clock, "Write to file");
    }

    function loadEmailsDef(): CommandMetadata {
        return {
            description: "Create new email index",
            options: {
                filePath: argDestFile(),
                name: arg("name"),
            },
        };
    }
    commands.kpEmailLoad.metadata = loadEmailsDef();
    async function emailsLoad(args: string[]) {
        const namedArgs = parseNamedArguments(args, loadEmailsDef());
        let emailIndexPath = namedArgs.filePath;
        emailIndexPath ??= namedArgs.name
            ? memoryNameToIndexPath(context.basePath, namedArgs.name)
            : undefined;
        if (!emailIndexPath) {
            context.printer.writeError("No index name or path provided");
            return;
        }
        closeEmail();
        context.email = cm.createEmailMemory(
            path.dirname(emailIndexPath),
            getFileName(emailIndexPath),
            true,
        );
    }

    function ensureIndexLoaded() {
        if (!context.email) {
            context.printer.writeError("No email index loaded");
            return false;
        }
        return true;
    }

    function closeEmail() {
        if (context.email) {
            context.email.close();
            context.email = undefined;
        }
    }
    return;
}
