// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { ChatModel, TextEmbeddingModel } from "aiclient";
import path from "node:path";
import { WebsiteCollection } from "./websiteCollection.js";
import { importWebsites, getDefaultBrowserPaths } from "./importWebsites.js";
import { IndexingResults } from "knowpro";
import { fileURLToPath } from "node:url";
import registerDebug from "debug";
import getFolderSize from "get-folder-size";

const debug = registerDebug("typeagent:indexingService");

// The type of data being indexed
export type IndexSource = "website" | "image" | "email";

export type IndexData = {
    source: IndexSource;
    name: string;
    location: string;
    size: number;
    path: string;
    state: "new" | "indexing" | "finished" | "stopped" | "idle" | "error";
    progress: number;
    sizeOnDisk: number;
    sourceType?: "bookmarks" | "history";
    browserType?: "chrome" | "edge";
};

// The different models being used for the index
export type Models = {
    chatModel: ChatModel;
    answerModel: ChatModel;
    embeddingModel: TextEmbeddingModel;
    embeddingModelSmall?: TextEmbeddingModel | undefined;
};

let index: IndexData | undefined = undefined;
let websites: WebsiteCollection | undefined = undefined;
let buildIndexPromise: Promise<IndexingResults> | undefined = undefined;
const incrementalBuildCheckPoint = {
    websiteCount: 0, // the # of websites in the index last time we did an incremental build
    minIncrementalBuildCount: 50, // the minimum number of websites between incremental builds
    minPercentageDiff: 1, // the # of percentage points between incremental builds
    lastBuildTimestamp: performance.now(),
    timeout: 15 * 60 * 1000, // 15 minutes
};

// only run the service if it was requested as part of the process startup
// i.e. if it's referenced by a module we don't want to run it, this action should be explicitly requested
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
     * @param current - The current item being processed
     * @param total - The total number of items to process
     * @param itemName - The name of the item that just got indexed
     */
    function indexingProgress(
        current: number,
        total: number,
        itemName: string,
    ) {
        index!.progress = current;
        index!.size = current;
        index!.state = "indexing";

        // incrementally rebuild the index at every percentage change of completeness but only do so non-aggressively
        // only increment at least every X websites or based on time passed
        if (
            (index!.size >
                incrementalBuildCheckPoint.websiteCount +
                    incrementalBuildCheckPoint.minIncrementalBuildCount &&
                incrementalBuildCheckPoint.websiteCount * 1.01 < index!.size) ||
            incrementalBuildCheckPoint.lastBuildTimestamp - performance.now() >
                incrementalBuildCheckPoint.timeout
        ) {
            buildIndexIncremental(websites!);

            incrementalBuildCheckPoint.websiteCount = index!.size;
            incrementalBuildCheckPoint.lastBuildTimestamp = performance.now();
        }

        // only report when we get significant progress updates
        if (current % 10 === 0 || current === total) {
            sendIndexStatus();
        }
    }

    async function startIndexing() {
        // can't do anything without an index definition
        if (index === undefined) {
            return;
        }

        // For website indexing, the location should be a browser data file path
        if (!fs.existsSync(index.location)) {
            debug(`The supplied file '${index.location}' does not exist.`);

            // Try to find default paths if none specified
            if (index.location === "default") {
                const defaultPaths = getDefaultBrowserPaths();
                let foundPath = "";

                // Try to find available browser data
                if (index.browserType === "chrome") {
                    if (
                        index.sourceType === "bookmarks" &&
                        fs.existsSync(defaultPaths.chrome.bookmarks)
                    ) {
                        foundPath = defaultPaths.chrome.bookmarks;
                    } else if (
                        index.sourceType === "history" &&
                        fs.existsSync(defaultPaths.chrome.history)
                    ) {
                        foundPath = defaultPaths.chrome.history;
                    }
                } else if (index.browserType === "edge") {
                    if (
                        index.sourceType === "bookmarks" &&
                        fs.existsSync(defaultPaths.edge.bookmarks)
                    ) {
                        foundPath = defaultPaths.edge.bookmarks;
                    } else if (
                        index.sourceType === "history" &&
                        fs.existsSync(defaultPaths.edge.history)
                    ) {
                        foundPath = defaultPaths.edge.history;
                    }
                }

                if (foundPath) {
                    index.location = foundPath;
                    debug(`Using default browser data path: ${foundPath}`);
                } else {
                    index.state = "error";
                    sendIndexStatus();
                    return;
                }
            } else {
                index.state = "error";
                sendIndexStatus();
                return;
            }
        }

        index.state = "indexing";
        sendIndexStatus();

        try {
            // Import website data - LOAD EXISTING COLLECTION FIRST
            debug(`Attempting to load existing collection from ${index.path}`);

            try {
                websites = await WebsiteCollection.readFromFile(
                    index.path,
                    "index",
                );

                if (!websites || websites.messages.length === 0) {
                    debug(
                        "No existing collection found or empty, creating new one",
                    );
                    websites = new WebsiteCollection();
                } else {
                    debug(
                        `Loaded existing collection with ${websites.messages.length} websites`,
                    );
                }
            } catch (loadError) {
                debug(
                    `Failed to load existing collection: ${loadError}. Creating new collection.`,
                );
                websites = new WebsiteCollection();
            }

            const browserType = index.browserType || "chrome";
            const sourceType = index.sourceType || "bookmarks";

            const importedWebsites = await importWebsites(
                browserType,
                sourceType,
                index.location,
                { limit: 10000 }, // reasonable limit
                indexingProgress,
            );

            // Filter out websites that already exist in the collection
            const existingUrls = new Set(
                websites.getWebsites().map((w) => w.metadata.url),
            );
            const newWebsites = importedWebsites.filter(
                (w) => !existingUrls.has(w.metadata.url),
            );

            if (newWebsites.length === 0) {
                debug(
                    `No new websites to add. Collection already has ${existingUrls.size} websites.`,
                );
                index!.state = "finished";
                sendIndexStatus();
                return;
            }

            debug(
                `Found ${newWebsites.length} new websites out of ${importedWebsites.length} imported (${existingUrls.size} already exist)`,
            );

            await addWebsitesIncremental(websites, newWebsites);

            debug(
                `Added ${newWebsites.length} new websites from ${browserType} ${sourceType}`,
            );

            await buildIndex(websites, true);
        } catch (error) {
            debug(`Error importing websites: ${error}`);
            index!.state = "error";
            sendIndexStatus();
        }
    }

    async function addWebsitesIncremental(
        websiteCollection: WebsiteCollection,
        newWebsites: any[],
    ) {
        for (const website of newWebsites) {
            try {
                const docPart = (
                    await import("./websiteDocPart.js")
                ).WebsiteDocPart.fromWebsite(website);
                await websiteCollection.addWebsiteToIndex(docPart);
            } catch (error) {
                debug(
                    `Error adding website incrementally: ${error}, falling back to batch add`,
                );
                websiteCollection.addWebsites([website]);
            }
        }
    }

    async function buildIndexIncremental(
        websites: WebsiteCollection,
        waitforPending: boolean = false,
    ) {
        if (waitforPending && buildIndexPromise) {
            await Promise.resolve(buildIndexPromise);
        }

        if (buildIndexPromise === undefined) {
            buildIndexPromise = websites.addToIndex();

            buildIndexPromise
                .then(async (value: IndexingResults) => {
                    debug(
                        `Incremental index update completed for ${websites!.messages.length} websites`,
                    );

                    await websites?.writeToFile(index!.path, "index");
                    debug(`Index saved to ${index!.path}`);

                    buildIndexPromise = undefined;
                })
                .catch(async (error) => {
                    debug(
                        `Error in incremental indexing: ${error}, falling back to full rebuild`,
                    );
                    try {
                        await websites.buildIndex();
                        await websites?.writeToFile(index!.path, "index");
                        debug(
                            `Fallback full rebuild completed and saved to ${index!.path}`,
                        );
                    } catch (fallbackError) {
                        debug(
                            `Fallback full rebuild also failed: ${fallbackError}`,
                        );
                        index!.state = "error";
                        sendIndexStatus();
                    }
                    buildIndexPromise = undefined;
                });
        }
    }

    async function buildIndex(
        websites: WebsiteCollection,
        waitforPending: boolean = false,
    ) {
        if (waitforPending && buildIndexPromise) {
            await Promise.resolve(buildIndexPromise);
        }

        if (buildIndexPromise === undefined) {
            buildIndexPromise = websites.buildIndex();

            buildIndexPromise
                .then(async (value: IndexingResults) => {
                    debug(`Found ${websites!.messages.length} websites`);

                    await websites?.writeToFile(index!.path, "index");

                    debug(`Index saved to ${index!.path}`);

                    index!.state = "finished";

                    index!.sizeOnDisk = (
                        await getFolderSize(index!.path as string)
                    ).size;

                    sendIndexStatus();

                    // reset indexing building promise
                    buildIndexPromise = undefined;
                })
                .catch((error) => {
                    debug(`Error building index: ${error}`);
                    index!.state = "error";
                    sendIndexStatus();
                    buildIndexPromise = undefined;
                });
        }
    }

    debug("Website indexing service started successfully.");
}
