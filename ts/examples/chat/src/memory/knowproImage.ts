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
} from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import * as kp from "knowpro";
import * as im from "image-memory";
import fs from "fs";
import path from "path";
import {
    createIndexingEventHandler,
    memoryNameToIndexPath,
    sourcePathToMemoryIndexPath,
} from "./knowproCommon.js";
import { argDestFile, argSourceFile } from "../common.js";
import { ensureDir, getFileName } from "typeagent";

export type KnowproImageContext = {
    printer: KnowProPrinter;
    images?: im.ImageCollection | undefined;
    basePath: string;
};

export async function createKnowproImageCommands(
    kpContext: KnowproContext,
    commands: Record<string, CommandHandler>,
) {
    const context: KnowproImageContext = {
        printer: kpContext.printer,
        basePath: kpContext.basePath,
    };

    commands.kpImages = showImages;
    commands.kpImagesImport = imagesImport;
    commands.kpImagesSave = imagesSave;
    commands.kpImagesLoad = imagesLoad;
    commands.kpImagesBuildIndex = imagesBuildIndex;

    function showImagesDef(): CommandMetadata {
        return {
            description: "Show all images",
            options: {
                maxMessages: argNum("Maximum images to display"),
            },
        };
    }
    commands.kpImages.metadata = "Show all images";
    async function showImages(args: string[]) {
        const conversation = ensureConversationLoaded();
        if (!conversation) {
            return;
        }
        const namedArgs = parseNamedArguments(args, showImagesDef());
        const messages =
            namedArgs.maxMessages > 0
                ? conversation.messages.getSlice(0, namedArgs.maxMessages)
                : conversation.messages;
        context.printer.writeMessages(messages);
    }

    function imageImportDef(): CommandMetadata {
        return {
            description: "Create knowPro image index",
            args: {
                filePath: arg("File path to an image file or folder"),
            },
            options: {
                knowledge: argBool("Index knowledge", true),
                related: argBool("Index related terms", true),
                indexFilePath: arg("Output path for index file"),
                maxMessages: argNum("Maximum images to index"),
                cachePath: arg("Path to image knowledge response cache."),
            },
        };
    }
    commands.kpImagesImport.metadata = imageImportDef();
    async function imagesImport(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, imageImportDef());
        if (!fs.existsSync(namedArgs.filePath)) {
            context.printer.writeError(`${namedArgs.filePath} not found`);
            return;
        }

        let progress = new ProgressBar(context.printer, 165);
        context.images = await im.importImages(
            namedArgs.filePath,
            namedArgs.cachePath,
            true,
            (text, _index, max) => {
                progress.total = max;
                progress.advance();
                return progress.count < max;
            },
        );
        kpContext.conversation = context.images;
        progress.complete();

        context.printer.writeLine("Imported images:");
        context.printer.writeImageCollectionInfo(context.images!);

        if (!namedArgs.index) {
            return;
        }

        // Build the image collection index
        await imagesBuildIndex(namedArgs);

        // Save the image collection index
        namedArgs.filePath = sourcePathToMemoryIndexPath(
            namedArgs.filePath,
            namedArgs.indexFilePath,
        );
        await imagesSave(namedArgs);
    }

    function imagesSaveDef(): CommandMetadata {
        return {
            description: "Save Image Collection",
            args: {
                filePath: argDestFile(),
            },
        };
    }

    commands.kpImagesSave.metadata = imagesSaveDef();
    async function imagesSave(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, imagesSaveDef());
        if (!context.images) {
            context.printer.writeError("No image collection loaded");
            return;
        }
        context.printer.writeLine("Saving index");
        context.printer.writeLine(namedArgs.filePath);
        if (context.images) {
            const dirName = path.dirname(namedArgs.filePath);
            await ensureDir(dirName);
            await context.images.writeToFile(
                dirName,
                getFileName(namedArgs.filePath),
            );
        }
    }

    function imagesLoadDef(): CommandMetadata {
        return {
            description: "Load knowPro image collection",
            options: {
                filePath: argSourceFile(),
                name: arg("Image Collection Name"),
            },
        };
    }

    commands.kpImagesLoad.metadata = imagesLoadDef();
    async function imagesLoad(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, imagesLoadDef());
        let imagesFilePath = namedArgs.filePath;
        imagesFilePath ??= namedArgs.name
            ? memoryNameToIndexPath(context.basePath, namedArgs.name)
            : undefined;
        if (!imagesFilePath) {
            context.printer.writeError("No filepath or name provided");
            return;
        }
        context.images = await im.ImageCollection.readFromFile(
            path.dirname(imagesFilePath),
            getFileName(imagesFilePath),
        );
        if (!context.images) {
            context.printer.writeLine("ImageCollection not found");
            return;
        }
        kpContext.conversation = context.images;
        context.printer.writeImageCollectionInfo(context.images);
    }

    function imageCollectionBuildIndexDef(): CommandMetadata {
        return {
            description: "Build image collection index",
            options: {
                knowledge: argBool("Index knowledge", false),
                related: argBool("Index related terms", false),
                maxMessages: argNum("Maximum messages to index"),
            },
        };
    }

    commands.kpImagesBuildIndex.metadata = imageCollectionBuildIndexDef();
    async function imagesBuildIndex(args: string[] | NamedArgs): Promise<void> {
        if (!context.images) {
            context.printer.writeError("No image collection loaded");
            return;
        }
        const messageCount = context.images.messages.length;
        if (messageCount === 0) {
            return;
        }

        const namedArgs = parseNamedArguments(
            args,
            imageCollectionBuildIndexDef(),
        );
        // Build index
        context.printer.writeLine();
        context.printer.writeLine("Building index");
        const maxMessages = namedArgs.maxMessages ?? messageCount;
        let progress = new ProgressBar(context.printer, maxMessages);
        const indexResult = await context.images?.buildIndex(
            createIndexingEventHandler(context.printer, progress, maxMessages),
        );
        progress.complete();
        context.printer.writeIndexingResults(indexResult);
    }

    function ensureConversationLoaded(): kp.IConversation | undefined {
        if (context.images) {
            return context.images;
        }
        context.printer.writeError("No conversation loaded");
        return undefined;
    }

    return;
}
