// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as cm from "conversation-memory";
import path from "path";
import fs from "fs";
import { KnowProPrinter } from "./knowproPrinter.js";
import { KnowproContext } from "./knowproMemory.js";
import {
    arg,
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    parseNamedArguments,
    ProgressBar,
    StopWatch,
} from "interactive-app";
import { ensureDir, getFileName } from "typeagent";
import {
    createIndexingEventHandler,
    sourcePathToMemoryIndexPath,
} from "./knowproCommon.js";
import { argSourceFile } from "../common.js";
import chalk from "chalk";

export type KnowproDocContext = {
    printer: KnowProPrinter;
    docMemory?: cm.DocMemory | undefined;
    maxCharsPerChunk: number;
    basePath: string;
};

export async function createKnowproDocMemoryCommands(
    kpContext: KnowproContext,
    commands: Record<string, CommandHandler>,
) {
    const DefaultMaxCharsPerChunk = 1024;
    const context: KnowproDocContext = {
        printer: kpContext.printer,
        basePath: path.join(kpContext.basePath, "docs"),
        maxCharsPerChunk: DefaultMaxCharsPerChunk,
    };

    await ensureDir(context.basePath);

    commands.kpDocImport = docImport;
    commands.kpDocLoad = docLoad;

    function docImportDef(): CommandMetadata {
        return {
            description: "Import a text document as DocMemory",
            args: {
                filePath: arg("File path to a txt, html or vtt file"),
            },
            options: {
                indexFilePath: arg("Output path for index file"),
                maxMessages: argNum("Maximum messages to index"),
                batchSize: argNum("Indexing batch size", 4),
                maxCharsPerChunk: argNum(
                    "How to chunk the document",
                    DefaultMaxCharsPerChunk,
                ),
                buildIndex: argBool("Index the imported podcast", true),
            },
        };
    }
    commands.kpDocImport.metadata = docImportDef();
    async function docImport(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, docImportDef());
        if (!fs.existsSync(namedArgs.filePath)) {
            context.printer.writeError(`${namedArgs.filePath} not found`);
            return;
        }
        const savePath = sourcePathToMemoryIndexPath(namedArgs.filePath);

        context.docMemory = await cm.importTextFile(
            namedArgs.filePath,
            namedArgs.maxCharsPerChunk,
        );
        kpContext.conversation = context.docMemory;
        writeDocInfo(context.docMemory);
        if (!namedArgs.buildIndex) {
            writeDoc(context.docMemory);
            return;
        }
        // Build index
        context.printer.writeLine("Building index");
        const maxMessages = context.docMemory.messages.length;
        let progress = new ProgressBar(context.printer, maxMessages);
        const eventHandler = createIndexingEventHandler(
            context.printer,
            progress,
            maxMessages,
        );
        const indexingResults =
            await context.docMemory.buildIndex(eventHandler);
        context.printer.writeIndexingResults(indexingResults);
        progress.complete();

        // Save the index
        await context.docMemory.writeToFile(
            path.dirname(savePath),
            getFileName(savePath),
        );
    }

    function docLoadDef(): CommandMetadata {
        return {
            description: "Load existing Doc memory",
            options: {
                filePath: argSourceFile(),
            },
        };
    }
    commands.kpDocLoad.metadata = docLoadDef();
    async function docLoad(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, docLoadDef());
        let memoryFilePath = sourcePathToMemoryIndexPath(namedArgs.filePath);
        if (!memoryFilePath) {
            context.printer.writeError("No filepath or name provided");
            return;
        }
        const clock = new StopWatch();
        clock.start();
        const docMemory = await cm.DocMemory.readFromFile(
            path.dirname(memoryFilePath),
            getFileName(memoryFilePath),
        );
        clock.stop();
        context.printer.writeTiming(chalk.gray, clock, "Read file");
        if (!docMemory) {
            context.printer.writeLine("DocMemory not found");
            return;
        }
        context.docMemory = docMemory;
        kpContext.conversation = context.docMemory;
        writeDocInfo(context.docMemory);
    }

    function writeDocInfo(docMemory: cm.DocMemory) {
        context.printer.writeLine(docMemory.nameTag);
        context.printer.writeLine(`${docMemory.messages.length} parts`);
    }

    function writeDoc(docMemory: cm.DocMemory) {
        for (const part of docMemory.messages) {
            for (const chunk of part.textChunks) {
                context.printer.write(chunk);
            }
        }
    }
    return;
}
