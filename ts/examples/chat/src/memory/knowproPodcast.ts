// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
import { KnowproContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as kp from "knowpro";
import * as cm from "conversation-memory";
import * as kpTest from "knowpro-test";
import fs from "fs";
import path from "path";
import {
    createIndexingEventHandler,
    //memoryNameToIndexPath,
    sourcePathToMemoryIndexPath,
} from "./knowproCommon.js";
import { argDestFile, argToDate, copyFileToDir } from "../common.js";
import { ensureDir, getAbsolutePath, getFileName } from "typeagent";
import chalk from "chalk";

export type KnowproPodcastContext = {
    printer: KnowProPrinter;
    podcast?: cm.Podcast | undefined;
    basePath: string;
};

export async function createKnowproPodcastCommands(
    kpContext: KnowproContext,
    commands: Record<string, CommandHandler>,
) {
    const context: KnowproPodcastContext = {
        printer: kpContext.printer,
        basePath: kpContext.basePath,
    };

    commands.kpPodcastImport = podcastImport;
    commands.kpPodcastSave = podcastSave;
    commands.kpPodcastLoad = podcastLoad;
    commands.kpPodcastBuildIndex = podcastBuildIndex;
    commands.kpPodcastBuildMessageIndex = podcastBuildMessageIndex;
    commands.kpPodcastLoadSample = podcastLoadSample;
    commands.kpPodcastImportVtt = podcastImportVtt;

    function podcastImportDef(): CommandMetadata {
        return {
            description: "Import a podcast transcript as Podcast memory",
            args: {
                filePath: arg("File path to transcript file"),
            },
            options: {
                startAt: arg("Start date and time"),
                indexFilePath: arg("Output path for index file"),
                maxMessages: argNum("Maximum messages to index"),
                batchSize: argNum("Indexing batch size", 4),
                length: argNum("Length of the podcast in minutes", 60),
                buildIndex: argBool("Index the imported podcast", true),
            },
        };
    }
    commands.kpPodcastImport.metadata = podcastImportDef();
    async function podcastImport(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, podcastImportDef());
        if (!fs.existsSync(namedArgs.filePath)) {
            context.printer.writeError(`${namedArgs.filePath} not found`);
            return;
        }
        const startAt = argToDate(namedArgs.startAt);
        const fileExt = path.extname(namedArgs.filePath);
        context.podcast =
            fileExt !== ".vtt"
                ? await cm.importPodcast(
                      namedArgs.filePath,
                      getFileName(namedArgs.filePath),
                      startAt,
                      namedArgs.length,
                  )
                : await cm.importPodcastFromVtt(
                      namedArgs.filePath,
                      getFileName(namedArgs.filePath),
                      startAt,
                  );

        kpContext.conversation = context.podcast;
        context.printer.writeLine("Imported podcast:");
        context.printer.writePodcastInfo(context.podcast);
        if (!namedArgs.buildIndex) {
            return;
        }
        // Build index
        await podcastBuildIndex(namedArgs);

        // Save the index
        namedArgs.filePath = sourcePathToMemoryIndexPath(
            namedArgs.filePath,
            namedArgs.indexFilePath,
        );
        await podcastSave(namedArgs);
    }

    function podcastSaveDef(): CommandMetadata {
        return {
            description: "Save Podcast",
            args: {
                filePath: argDestFile(),
            },
        };
    }
    commands.kpPodcastSave.metadata = podcastSaveDef();
    async function podcastSave(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, podcastSaveDef());
        if (!context.podcast) {
            context.printer.writeError("No podcast loaded");
            return;
        }
        context.printer.writeLine("Saving index");
        context.printer.writeLine(namedArgs.filePath);
        const dirName = path.dirname(namedArgs.filePath);
        await ensureDir(dirName);

        const clock = new StopWatch();
        clock.start();
        await context.podcast.writeToFile(
            dirName,
            getFileName(namedArgs.filePath),
        );
        clock.stop();
        context.printer.writeTiming(chalk.gray, clock, "Write to file");
    }

    commands.kpPodcastLoad.metadata = kpTest.podcastLoadDef();
    async function podcastLoad(args: string[]): Promise<void> {
        const clock = new StopWatch();
        clock.start();
        const loadResult = await kpTest.execLoadPodcast(kpContext, args);
        clock.stop();
        context.printer.writeTiming(chalk.gray, clock, "Load podcast");
        if (!loadResult.success) {
            context.printer.writeError(loadResult.message);
            return;
        }
        context.podcast = loadResult.data;
        context.printer.writePodcastInfo(context.podcast);
    }

    function podcastBuildIndexDef(): CommandMetadata {
        return {
            description: "Build index",
            options: {
                maxMessages: argNum("Maximum messages to index"),
                batchSize: argNum("Indexing batch size", 8),
            },
        };
    }
    commands.kpPodcastBuildIndex.metadata = podcastBuildIndexDef();
    async function podcastBuildIndex(
        args: string[] | NamedArgs,
    ): Promise<void> {
        if (!context.podcast) {
            context.printer.writeError("No podcast loaded");
            return;
        }
        const messageCount = context.podcast.messages.length;
        if (messageCount === 0) {
            return;
        }

        const namedArgs = parseNamedArguments(args, podcastBuildIndexDef());
        // Build index
        context.printer.writeLine();
        const maxMessages = namedArgs.maxMessages ?? messageCount;
        let originalMessages = context.podcast.messages;
        try {
            if (maxMessages < messageCount) {
                context.podcast.messages =
                    new kp.MessageCollection<cm.PodcastMessage>(
                        context.podcast.messages.getSlice(0, maxMessages),
                    );
            }
            context.printer.writeLine(`Building Index`);
            let progress = new ProgressBar(context.printer, maxMessages);
            const eventHandler = createIndexingEventHandler(
                context.printer,
                progress,
                maxMessages,
            );
            // Build full index?
            const clock = new StopWatch();
            clock.start();

            context.podcast.settings.semanticRefIndexSettings.batchSize =
                namedArgs.batchSize;
            const indexResult = await context.podcast.buildIndex(eventHandler);

            clock.stop();
            progress.complete();
            context.printer.writeTiming(chalk.gray, clock);
            context.printer.writeIndexingResults(indexResult);
        } finally {
            context.podcast.messages = originalMessages;
        }
    }

    function podcastBuildMessageIndexDef(): CommandMetadata {
        return {
            description: "Build fuzzy message index for the podcast",
            options: {
                maxMessages: argNum("Maximum messages to index"),
                batchSize: argNum("Batch size", 4),
            },
        };
    }
    commands.kpPodcastBuildMessageIndex.metadata =
        podcastBuildMessageIndexDef();
    async function podcastBuildMessageIndex(args: string[]): Promise<void> {
        if (!ensureConversationLoaded()) {
            return;
        }
        const namedArgs = parseNamedArguments(
            args,
            podcastBuildMessageIndexDef(),
        );
        context.printer.writeLine(`Indexing messages`);

        const podcast = context.podcast!;
        const settings: kp.MessageTextIndexSettings = {
            ...context.podcast!.settings.messageTextIndexSettings,
        };
        settings.embeddingIndexSettings.batchSize = namedArgs.batchSize;
        let progress = new ProgressBar(context.printer, namedArgs.maxMessages);
        podcast.secondaryIndexes.messageIndex = new kp.MessageTextIndex(
            settings,
        );
        const result = await kp.buildMessageIndex(
            podcast,
            settings,
            createIndexingEventHandler(
                context.printer,
                progress,
                namedArgs.maxMessages,
            ),
        );
        progress.complete();
        context.printer.writeListIndexingResult(result);
    }

    commands.kpPodcastLoadSample.metadata = "Load sample podcast index";
    async function podcastLoadSample(args: string[]) {
        let samplePath =
            "../../../../packages/knowPro/test/data/Episode_53_AdrianTchaikovsky.txt";
        samplePath = getAbsolutePath(samplePath, import.meta.url);
        const podcastName = getFileName(samplePath);
        await ensureSampleCopied(samplePath);
        context.printer.writeLine(
            `Loading indexes for ${path.resolve(samplePath)}`,
        );
        context.printer.writeLine();
        await podcastLoad(["--name", podcastName]);
    }

    function podcastImportVttDef(): CommandMetadata {
        const def = podcastImportDef();
        def.description = "Import podcast from VTT files";
        return def;
    }
    commands.kpPodcastImportVtt.metadata = podcastImportVttDef();
    async function podcastImportVtt(args: string[]) {
        const namedArgs = parseNamedArguments(args, podcastImportVttDef());
        await podcastImport(namedArgs);
        if (!context.podcast) {
            return;
        }
        if (!namedArgs.buildIndex) {
            context.printer.writeLine();
            context.printer.writeMessages(context.podcast.messages);
        }
    }

    async function ensureSampleCopied(transcriptPath: string) {
        const srcDir = path.dirname(transcriptPath);
        const fileName = getFileName(transcriptPath);

        const files = fs
            .readdirSync(srcDir)
            .filter((file) => file.startsWith(fileName));
        const destDir = context.basePath;
        await ensureDir(destDir);
        for (const file of files) {
            const srcPath = path.join(srcDir, file);
            await copyFileToDir(srcPath, destDir, false);
        }
    }

    function ensureConversationLoaded(): kp.IConversation | undefined {
        if (context.podcast) {
            return context.podcast;
        }
        context.printer.writeError("No podcast loaded");
        return undefined;
    }

    return;
}
