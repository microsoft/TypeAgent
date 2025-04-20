// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This script starts an indexing service

import fs from "node:fs";
//import { StopWatch } from "telemetry";
import { ChatModel, TextEmbeddingModel, openai } from "aiclient";
import { isDirectoryPath } from "typeagent";
import path from "node:path";
//import { isImageFileType } from "common-utils";
import * as knowLib from "knowledge-processor";
import { ImageCollection, importImages }  from "image-memory";
import { IndexingResults } from "knowpro";

// The type of data being indexed
export type IndexSource = "image" | "email";

// The meta data about the index
export type IndexData = {
    source: IndexSource,// the data source of the index
    name: string,       // the name of the index 
    location: string,    // the location that has been index
    size: number,        // the # of items in the index
    path: string,        // the path to the index
    state: "new" | "running" | "finished" | "stopped" | "error" // the state of the indexing service for this index
}

// The different models being used for the index
export type Models = {
    chatModel: ChatModel;
    answerModel: ChatModel;
    embeddingModel: TextEmbeddingModel;
    embeddingModelSmall?: TextEmbeddingModel | undefined;
};

let index: IndexData | undefined = undefined;
let stats: knowLib.IndexingStats | undefined;
//const maxCharsPerChunk: number = 4096;
let images: ImageCollection | undefined = undefined;

/**
 * Indicate to the host/parent process that we've started successfully
 */
process.send?.("Success");

/**
 * Processes messages received from the host/parent process
 */
process.on("message", (message: any) => {
    console.log(message);

    if (message as IndexData != undefined) {
        index = message as IndexData;

        startIndexing();
    }
    
});

/**
 * Closes this process at the request of the host/parent process
 */
process.on("disconnect", () => {
    process.exit(1);
});

export function createModels(): Models {
    const chatModelSettings = openai.apiSettingsFromEnv(openai.ModelType.Chat);
    chatModelSettings.retryPauseMs = 10000;
    const embeddingModelSettings = openai.apiSettingsFromEnv(
        openai.ModelType.Embedding,
    );
    embeddingModelSettings.retryPauseMs = 25 * 1000;

    const models: Models = {
        chatModel: openai.createJsonChatModel(chatModelSettings, [
            "chatMemory",
        ]),
        answerModel: openai.createChatModel(),
        embeddingModel: knowLib.createEmbeddingCache(
            openai.createEmbeddingModel(embeddingModelSettings),
            1024,
        ),
        /*
        embeddingModelSmall: knowLib.createEmbeddingCache(
            openai.createEmbeddingModel("3_SMALL", 1536),
            256,
        ),
        */
    };
    models.chatModel.completionSettings.seed = 123;
    models.answerModel.completionSettings.seed = 123;
    return models;
}

function captureTokenStats(req: any, response: any): void {
    if (stats) {
        stats.updateCurrentTokenStats(response.usage);
    }
    if (false) {
        //printer.writeCompletionStats(response.usage);
        //printer.writeLine();
    } else {
        //printer.write(".");
    }
}

const models: Models = createModels();
models.chatModel.completionCallback = captureTokenStats;
models.answerModel.completionCallback = captureTokenStats;

// const imageMemory: knowLib.conversation.ConversationManager = await createImageMemory(
//     models,
//     storePath,
//     conversationSettings,
//     true,
//     false,
// );

async function startIndexing() {

    // can't do anything without an index definition
    if (index === undefined) {
        return;
    }

    // TODO: create resumable status file and check it here and resume from that point

    if (!fs.existsSync(index.location)) {
        console.log(
            `The supplied file or folder '${index.location}' does not exist.`,
        );
        return;
    }

    if (!isDirectoryPath(index.location)) {
        console.log(`The supplied index path is not a directory!`);
        return;
    }

    //const clock: StopWatch = new StopWatch();
    // const tokenCountStart: openai.CompletionUsageStats =
    //     TokenCounter.getInstance().total;

    // get image knowledge
    images = await importImages(
        index.location,
        path.join(index.location, "cache"),
        true,
    );

    // build the index
    images.buildIndex().then(
        (value: IndexingResults) => {

            console.log(`Found ${images!.messages.entries} images`);

            images?.writeToFile(index!.path, "index");
        }
    );

    // const tokenCountFinish: openai.CompletionUsageStats =
    //     TokenCounter.getInstance().total;

    // clock.stop();
    // console.log(`Total Duration: ${clock.elapsedSeconds} seconds`);
    // console.log(
    //     `Prompt Token Consupmtion: ${tokenCountFinish.prompt_tokens - tokenCountStart.prompt_tokens}`,
    // );
    // console.log(
    //     `Completion Token Consupmtion: ${tokenCountFinish.completion_tokens - tokenCountStart.completion_tokens}`,
    // );
    // console.log(
    //     `Total Tokens: ${tokenCountFinish.total_tokens - tokenCountStart.total_tokens}`,
    // );
}

// async function indexImages(
//     sourcePath: string,
//     cachePath: string,
//     clock: StopWatch,
// ) {
//     // load files from directory
//     const fileNames = await fs.promises.readdir(sourcePath, {
//         recursive: true,
//     });

//     // index each image
//     for (let i = 0; i < fileNames.length; i++) {
//         const fullFilePath: string = path.join(sourcePath, fileNames[i]);
//         console.log(
//             `${fullFilePath} [${i + 1} of ${fileNames.length}] (estimated time remaining: ${(clock.elapsedSeconds / (i + 1)) * (fileNames.length - i)})`,
//         );
//         await indexImage(fullFilePath, cachePath);
//     }
// }

// async function indexImage(
//     fileName: string,
//     cachePath: string,
// ) {
//     if (!fs.existsSync(fileName)) {
//         console.log(`Could not find part of the file path '${fileName}'`);
//         return;
//     } else if (!isImageFileType(path.extname(fileName))) {
//         console.log(`Skipping '${fileName}', not a known image file.`);
//         return;
//     }

//     // load the image
//     const image: knowLib.image.Image | undefined =
//         await knowLib.image.loadImage(
//             fileName,
//             models.chatModel,
//             true,
//             cachePath,
//         );

//     if (image) {
//         await knowLib.image.addImageToConversation(
//             imageMemory,
//             image,
//             maxCharsPerChunk,
//             context.conversationManager.knowledgeExtractor,
//         );
//     }
// }

console.log("Indexing service started successfully.");

