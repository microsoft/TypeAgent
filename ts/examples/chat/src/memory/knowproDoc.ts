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
    NamedArgs,
    parseNamedArguments,
    ProgressBar,
    StopWatch,
} from "interactive-app";
import { ensureDir, getFileName } from "typeagent";
import {
    createIndexingEventHandler,
    setKnowledgeExtractorV2,
    sourcePathToMemoryIndexPath,
} from "./knowproCommon.js";
import { argSourceFile } from "../common.js";

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
                v2: argBool("Use v2 knowledge extraction", false),
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
        context.docMemory = await cm.importTextFile(
            namedArgs.filePath,
            namedArgs.maxCharsPerChunk,
            undefined,
            kpContext.createMemorySettings(),
        );
        kpContext.conversation = context.docMemory;
        writeDocInfo(context.docMemory);
        if (!namedArgs.buildIndex) {
            writeDoc(context.docMemory);
            return;
        }
        // Build index
        await buildDocIndex(namedArgs);
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
            kpContext.createMemorySettings(),
        );
        clock.stop();

        context.printer.writeTiming(clock, "Read file");
        if (!docMemory) {
            context.printer.writeLine("DocMemory not found");
            return;
        }
        context.docMemory = docMemory;
        kpContext.conversation = context.docMemory;
        writeDocInfo(context.docMemory);
    }

    async function buildDocIndex(namedArgs: NamedArgs): Promise<void> {
        if (!context.docMemory) {
            return;
        }
        const savePath = sourcePathToMemoryIndexPath(namedArgs.filePath);
        // Build index
        context.printer.writeLine("Building index");
        if (namedArgs.v2) {
            context.printer.writeLine("Using v2 knowledge extractor");
            setKnowledgeExtractorV2(
                context.docMemory.settings.conversationSettings,
            );
        }
        const maxMessages = context.docMemory.messages.length;
        let progress = new ProgressBar(context.printer, maxMessages);
        const eventHandler = createIndexingEventHandler(
            context.printer,
            progress,
            maxMessages,
        );

        kpContext.startTokenCounter();
        kpContext.stopWatch.start();
        const indexingResults =
            await context.docMemory.buildIndex(eventHandler);
        kpContext.stopWatch.stop();
        progress.complete();

        context.printer.writeIndexingResults(indexingResults);
        context.printer.writeTiming(kpContext.stopWatch);
        context.printer.writeCompletionStats(kpContext.tokenStats);
        // Save the index
        await context.docMemory.writeToFile(
            path.dirname(savePath),
            getFileName(savePath),
        );
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
