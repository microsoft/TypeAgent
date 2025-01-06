// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ArgDef, CommandHandler, CommandMetadata, InteractiveIo, NamedArgs, parseNamedArguments } from "interactive-app";
import { ChatContext, Models, ReservedConversationNames } from "./chatMemory.js";
import { argSourceFileOrFolder } from "./common.js";
import { ensureDir, isDirectoryPath } from "typeagent";
import fs from "node:fs";
import * as knowLib from "knowledge-processor";
import { conversation } from "knowledge-processor";
import path from "node:path";
import { sqlite } from "memory-providers";
import * as knowlib from "knowledge-processor";

export async function createImageMemory(
    models: Models,
    storePath: string,
    settings: conversation.ConversationSettings,
    useSqlite: boolean = false,
    createNew: boolean = false,
) {
    const imageSettings: conversation.ConversationSettings = {
        ...settings,
    };
    if (models.embeddingModelSmall) {
        imageSettings.entityIndexSettings = {
            ...settings.indexSettings,
        };
        imageSettings.entityIndexSettings.embeddingModel =
            models.embeddingModelSmall;
        imageSettings.actionIndexSettings = {
            ...settings.indexSettings,
        };
        imageSettings.actionIndexSettings.embeddingModel =
            models.embeddingModelSmall;
    }
    const imageStorePath = path.join(
        storePath,
        ReservedConversationNames.images,
    );
    await ensureDir(imageStorePath);
    const storage = useSqlite
        ? await sqlite.createStorageDb(imageStorePath, "images.db", createNew)
        : undefined;

    const memory = await knowLib.image.createImageMemory(
        models.chatModel,
        models.answerModel,
        ReservedConversationNames.images,
        storePath,
        imageSettings,
        storage,
    );
    memory.searchProcessor.answers.settings.chunking.fastStop = true;
    return memory;
}

export function argPause(defaultValue = 0): ArgDef {
    return {
        type: "number",
        defaultValue,
        description: "Pause for given milliseconds after each iteration",
    };
}

export function importImageDef(): CommandMetadata {
    return {
        description: "Imports an image or set of images in a folder",
        args: {
            sourcePath: argSourceFileOrFolder(),
        },
        options: {
            pauseMs: argPause(),
        }
    };
}

export function createImageCommands(context: ChatContext, commands: Record<string, CommandHandler>): void {
    commands.importImage = importImage;
    commands.importImage.metadata = importImageDef();

    async function importImage(args: string[], io: InteractiveIo) {
        const namedArgs = parseNamedArguments(args, importImageDef())
        let sourcePath: string = namedArgs.sourcePath;
        let isDir = isDirectoryPath(sourcePath);

        if (isDir) {
            await indexImages(namedArgs, sourcePath, context);
        } else {
            await indexImage(sourcePath, context);
        } 
    }

    async function indexImages(namesArgs: NamedArgs, sourcePath: string, context: ChatContext) {

        // load files from directory
        const fileNames = await fs.promises.readdir(sourcePath, { recursive: true });
        
        // index each image
        fileNames.map(async (fileName) => { 
            console.log(fileName);
            await indexImage(fileName, context);
        });
    }

    async function indexImage(fileName: string, context: ChatContext) {
        if (!fs.existsSync(fileName)) {
            context.printer.writeLine(`Could not find part of the file path '${fileName}'`);
            return;
        }

        const image: knowLib.Image = loadImage(fileName);

        knowLib.image.addImageToConversation(context.imageMemory, image, context.maxCharsPerChunk);
    }
}
