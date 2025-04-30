// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    CommandHandler,
    CommandMetadata,
    parseNamedArguments,
} from "interactive-app";
import { KnowProContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as cm from "conversation-memory";
import { argDestFile } from "./common.js";
import path from "path";
import { ensureDir } from "typeagent";

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

    commands.kpEmailLoad = loadIndex;

    function loadIndexDef(): CommandMetadata {
        return {
            description: "Create new email index",
            options: {
                filePath: argDestFile(),
                name: arg("name"),
            },
        };
    }
    commands.kpEmailLoad.metadata = loadIndexDef();
    async function loadIndex(args: string[]) {
        const namedArgs = parseNamedArguments(args, loadIndexDef());
        let dbFilePath = namedArgs.filePath;
        if (!dbFilePath && namedArgs.name) {
            dbFilePath = path.join(context.basePath, namedArgs.name);
        }
        if (!dbFilePath) {
            context.printer.writeError("No index name or path provided");
            return;
        }
        if (!dbFilePath.endsWith(".db")) {
            dbFilePath += ".db";
        }
        closeEmail();
        context.email = cm.createEmailMemoryOnDb(dbFilePath, true);
    }

    function closeEmail() {
        if (context.email) {
            context.email.close();
            context.email = undefined;
        }
    }
    return;
}
