// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess, fork } from "node:child_process";
import fs, { existsSync } from "node:fs";
import registerDebug from "debug";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { ensureDirectory, getUniqueFileName } from "../utils/fsUtils.js";
import path from "node:path";
import { ensureDir, isDirectoryPath } from "@typeagent/agent-runtime";
import { IndexData, IndexSource } from "@typeagent/image-memory";
import { IndexingServiceRegistry } from "./indexingServiceRegistry.js";
// import { searchConversationKnowledge } from "@typeagent/knowpro";

const debug = registerDebug("typeagent:indexManager");

// TODO: add support to be able to "disable" an index

/*
 * IndexManager is a singleton class that manages the indexes for the system.
 */
export class IndexManager {
    private static instance: IndexManager;
    private indexingServices: Map<IndexData, ChildProcess | undefined> =
        new Map<IndexData, ChildProcess | undefined>();
    private static rootPath: string;
    private static indexingRegistry: IndexingServiceRegistry | undefined;
    //private cacheRoot: string;
    private static imageRoot: string | undefined;
    private static emailRoot: string | undefined;

    public static getInstance = (): IndexManager => {
        if (!IndexManager.instance) {
            IndexManager.instance = new IndexManager();
        }
        return IndexManager.instance;
    };

    /*
     * Loads the supplied indexes
     */
    public static async load(
        indexesToLoad: IndexData[],
        sessionDir: string,
        serviceRegistry?: IndexingServiceRegistry,
    ) {
        this.rootPath = path.join(sessionDir, "indexes");
        this.indexingRegistry = serviceRegistry;

        ensureDirectory(IndexManager.rootPath);

        // make sure the indexes folder exists
        IndexManager.imageRoot = path.join(IndexManager.rootPath, "image");
        ensureDirectory(IndexManager.imageRoot!);

        // TODO: find a good way to make a shared cache of .kr files and thumbnails for images
        // IndexManager.cacheRoot = path.join(IndexManager.rootPath, "cache");
        // ensureDirectory(IndexManager.cacheRoot);

        IndexManager.emailRoot = path.join(IndexManager.rootPath, "email");
        ensureDirectory(IndexManager.emailRoot!);

        indexesToLoad.forEach((value) => {
            this.getInstance().addIndex(value);
        });
    }

    /*
     * Gets the available indexes
     */
    public get indexes(): IndexData[] {
        const indexes: IndexData[] = [];
        this.indexingServices.forEach((cp, key) => indexes.push(key));

        return indexes;
    }

    /*
     * Creates the the index with the supplied settings
     */
    public async createIndex(
        name: string,
        source: IndexSource,
        location: string,
    ): Promise<boolean> {
        // spin up the correct indexer based on the request
        switch (source) {
            case "image":
                await this.createImageIndex(name, location);
                break;
            case "website":
                throw new Error(
                    "Website indexes are no longer created with @index. Use the browser extension or the @memory agent to add pages to durable memory.",
                );
            case "email":
                throw new Error("Email indexing is not implemented yet.");
            default:
                throw new Error(`Unknown index source: ${source}`);
        }

        return true;
    }

    /*
     * Create the image index for the specified location
     */
    private async createImageIndex(name: string, location: string) {
        if (!existsSync(location)) {
            throw new Error(`Location '${location}' does not exist.`);
        }

        if (!isDirectoryPath(location)) {
            throw new Error(
                `Location '${location}' is not a directory.  Please specify a valid directory.`,
            );
        }

        const dirName = getUniqueFileName(IndexManager.imageRoot!, "index");
        const folder = await ensureDir(
            path.join(IndexManager.imageRoot!, dirName),
        );

        const index: IndexData = {
            source: "image",
            name,
            location,
            size: 0,
            path: folder,
            state: "new",
            progress: 0,
            sizeOnDisk: 0,
        };

        // start indexing
        this.addIndex(index);
    }

    public deleteIndex(name: string): boolean {
        this.indexingServices.forEach((childProc, index) => {
            if (index.name == name) {
                // kill the index process
                childProc?.kill();

                // remove the index from the list of indexes
                this.indexingServices.delete(index);

                // remove the folder where the index is stored
                fs.promises
                    .rm(index.path, { recursive: true, force: true })
                    .catch((reason) => debug(reason));
            }
        });

        return true;
    }

    private addIndex(index: IndexData) {
        if (index.state === "finished") {
            this.indexingServices.set(index, undefined);
            return;
        }

        // start service for unfinished indexes
        try {
            let serviceRoot: string;

            // Try to use registry-based service discovery first
            if (IndexManager.indexingRegistry) {
                const serviceInfo = IndexManager.indexingRegistry.get(
                    index.source,
                );
                if (serviceInfo) {
                    debug(
                        `Using registered indexing service for ${index.source}: ${serviceInfo.agentName}/${serviceInfo.serviceScript}`,
                    );

                    serviceRoot = serviceInfo.serviceScript;
                } else {
                    debug(
                        `No registered service found for ${index.source}, falling back to defaults`,
                    );
                    serviceRoot = this.getDefaultServicePath(index.source);
                }
            } else {
                debug(
                    `No indexing registry available, using legacy service discovery`,
                );
                serviceRoot = this.getDefaultServicePath(index.source);
            }

            const childProcess = fork(serviceRoot, {
                stdio: ["pipe", "inherit", "pipe", "ipc"],
            });
            childProcess.stderr?.on("data", (chunk: Buffer) => {
                process.stderr.write(chunk);
            });

            this.indexingServices.set(index, childProcess);

            childProcess.on("message", function (message) {
                if (message === "Success") {
                    childProcess.send(index);
                    return;
                }
                if (message === "Failure") {
                    index.state = "error";
                    return;
                }
                // TODO: get notification of when the index is rebuilt so that we can notify users that they could/should reload their index instances
                const idx: IndexData | undefined = message as IndexData;
                IndexManager.getInstance().indexingServices.forEach(
                    (childProc, index) => {
                        if (index.location === idx.location) {
                            index.size = idx.size;
                            index.state = idx.state;
                            index.progress = idx.progress;
                            index.sizeOnDisk = idx.sizeOnDisk;
                        }
                    },
                );
            });

            childProcess.on("exit", (code) => {
                debug(`Index service ${index.name} exited with code:`, code);
            });
        } catch (e: any) {
            console.error(e);
        }
    }

    private getDefaultServicePath(indexSource: IndexSource): string {
        // Legacy service discovery for backward compatibility
        if (indexSource === "website") {
            throw new Error(
                "Website indexes are stored in durable memory and have no indexing service.",
            );
        }
        return getPackageFilePath(
            "./node_modules/image-memory/dist/indexingService.js",
        );
    }
}
