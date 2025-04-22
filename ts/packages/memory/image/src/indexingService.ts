// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This script starts an indexing service for images
// TODO: add support for "monitoring" the indexed folder for changes

import fs from "node:fs";
import { ChatModel, TextEmbeddingModel } from "aiclient";
import { isDirectoryPath } from "typeagent";
import path from "node:path";
import { ImageCollection, importImages } from "image-memory";
import { IndexingResults } from "knowpro";
import { fileURLToPath } from "node:url";
import registerDebug from "debug";
import getFolderSize from "get-folder-size";

const debug = registerDebug("typeagent:indexingService");

// The type of data being indexed
export type IndexSource = "image" | "email";

// The meta data about the index
// TODO: add token stats
export type IndexData = {
    source: IndexSource; // the data source of the index
    name: string; // the name of the index
    location: string; // the location that has been indexed
    size: number; // the # of items in the index
    path: string; // the path to the index
    state: "new" | "indexing" | "finished" | "stopped" | "idle" | "error"; // the state of the indexing service for this index
    progress: number; // the # of items processed for indexing (knowledge extraction)
    sizeOnDisk: number; // the amount of space on disk this index is consuming
};

// The different models being used for the index
export type Models = {
    chatModel: ChatModel;
    answerModel: ChatModel;
    embeddingModel: TextEmbeddingModel;
    embeddingModelSmall?: TextEmbeddingModel | undefined;
};

let index: IndexData | undefined = undefined;
let images: ImageCollection | undefined = undefined;

// only run the service if it was requested as part of the process startup
// i.e. if it's referenced by a module we don't wan't to run it, this action should be explicitly requested
if (
    process.argv.filter((value: string) => {
        const thisFile = fileURLToPath(import.meta.url);
        return path.basename(value) === path.basename(thisFile);
    }).length > 0
) {
    /**
     * Indicate to the host/parent process that we've started successfully
     */
    process.send?.("Success");

    /**
     * Processes messages received from the host/parent process
     */
    process.on("message", (message: any) => {
        debug(message);

        if (message !== undefined) {
            debug(message);
            index = message as IndexData;

            if (index.location !== undefined) {
                startIndexing();
            }
        }
    });

    /**
     * Closes this process at the request of the host/parent process
     */
    process.on("disconnect", () => {
        process.exit(1);
    });

    // Sends the index state to the host process
    function sendIndexStatus() {
        process.send?.(index);
    }

    /*
     * Notifies the host process of the progress of the indexing
     *
     * @param text - The name of the item that just got indexed
     * @param count - The index of the item that just got indexed (of the total items in the same folder)
     * @param max - The number of items in the current folder being indexed
     */
    function indexingProgress(text: string, count: number, max: number) {
        index!.progress++;
        index!.size++;
        index!.state = "indexing";

        // TODO: incremental index rebuilding

        // TODO: make this less chatty - maybe percentage based or something?
        // only report when we get to the end of a folder
        //    if (count === max) {
        sendIndexStatus();
        //    }
    }

    async function startIndexing() {
        // can't do anything without an index definition
        if (index === undefined) {
            return;
        }

        if (!fs.existsSync(index.location)) {
            debug(
                `The supplied file or folder '${index.location}' does not exist.`,
            );
            return;
        }

        if (!isDirectoryPath(index.location)) {
            debug(`The supplied index path is not a directory!`);
            return;
        }

        index.state = "indexing";
        sendIndexStatus();

        // get image knowledge
        images = await importImages(
            index.location,
            path.join(index.path, "cache"),
            true,
            indexingProgress,
        );

        // build the index
        images.buildIndex().then(async (value: IndexingResults) => {
            debug(`Found ${images!.messages.entries} images`);

            await images?.writeToFile(index!.path, "index");

            debug(`Index saved to ${index!.path}`);

            index!.state = "finished";

            index!.sizeOnDisk = (
                await getFolderSize(index!.path as string)
            ).size;

            sendIndexStatus();
        });
    }

    debug("Indexing service started successfully.");
}
