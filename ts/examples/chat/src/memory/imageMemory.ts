// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ArgDef, CommandHandler, CommandMetadata, InteractiveIo, NamedArgs, parseNamedArguments } from "interactive-app";
import { ChatContext } from "./chatMemory.js";
import { argSourceFileOrFolder } from "./common.js";
import { isDirectoryPath } from "typeagent";
import fs from "node:fs";
//import * as knowLib from "knowledge-processor";

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
    commands.importImage = importImage
    commands.importImage.metadata = importImageDef();

    async function importImage(args: string[], io: InteractiveIo) {
        const namedArgs = parseNamedArguments(args, importImageDef())
        let sourcePath: string = namedArgs.sourcePath;
        let isDir = isDirectoryPath(sourcePath);

        if (isDir) {
            await indexImages(namedArgs, sourcePath);
        } else if (fs.existsSync(sourcePath)) {
            // if (
            //     !(await knowLib.image.addImageToConversation(
            //         context.emailMemory,
            //         sourcePath,
            //         namedArgs.chunkSize,
            //     ))
            // ) {
            //     context.printer.writeLine(`Could not load ${sourcePath}`);
            // }
        } else {
            context.printer.writeLine(`Could not find part of the file path '${sourcePath}'`);
        }
    }

    async function indexImages(namesArgs: NamedArgs, sourcePath: string) {
        // load files from directory
        const fileNames = await fs.promises.readdir(sourcePath, { recursive: true });
        
        // index each image
        fileNames.map((fileName) => { console.log(fileName)});
    }
}
