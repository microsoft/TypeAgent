// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess, fork } from "node:child_process";
import fs, { existsSync } from "node:fs";
import registerDebug from "debug";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { getUniqueFileName } from "../utils/fsUtils.js";
import path from "node:path";
import { ensureDir } from "typeagent";
import { getInstanceSessionsDirPath } from "../explorer.js";

const debug = registerDebug("typeagent:indexManager");

export type IndexSource = "image" | "email";

export type IndexData = {
    source: IndexSource,// the data source of the index
    name: string,       // the name of the index 
    location: string    // the location that has been index
    size: number        // the # of items in the index
    path: string        // the path to the index
}

/*
* IndexManager is a singleton class that manages the indexes for the system.
*/
export class IndexManager {
    private static instance: IndexManager;
    private idx: IndexData[] = [];
    private indexingServicePromise: Promise<ChildProcess | undefined> | undefined;
    private indexingService: ChildProcess | undefined;

    public static getInstance = (): IndexManager => {
        if (!IndexManager.instance) {
            IndexManager.instance = new IndexManager();

            // spin up the indexing service
            IndexManager.instance.indexingServicePromise = IndexManager.startIndexingService();
        }
        return IndexManager.instance;
    }

    /*
    * Loads the supplied indexes
    */
    public static load(indexesToLoad: IndexData[]) {
        this.getInstance().idx = indexesToLoad;

        // TODO: parse, get their status, resume indexing, setup monitors, etc.
    }

    /*
    * Gets the available indexes
    */
    public get indexes(): IndexData[] {
        return this.idx;
    }

    /*
    * Creates the the index with the supplied settings
    */
    public async createIndex(name: string, source: IndexSource, location: string): Promise<boolean> {

        // make sure we're loaded
        this.indexingService = await Promise.resolve(this.indexingServicePromise);

        // spin up the correct indexer based on the request
        switch (source) {
            case "image":
                await this.createImageIndex(name, location);
                break;
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
            throw new Error(`Location ${location} does not exist.`);
        }

        const folder = await ensureDir(getUniqueFileName(path.join(getInstanceSessionsDirPath(), "indexes", "image")));

        this.idx.push({
            source: "image",
            name,
            location,
            size: 0,
            path: folder
        });

        // TODO: start indexing
        this.indexingService?.send({ start: true });
    }

    public deleteIndex(name: string): boolean {
        
        // TODO: stop indexing

        this.idx.filter((index: IndexData) => index.name === name).forEach((index: IndexData) => {
            this.idx.splice(this.idx.indexOf(index), 1);

            fs.promises.rm(index.path, { recursive: true, force: true }).catch((reason) => debug(reason));
        });

        return true;
    }

    private static startIndexingService(): Promise<ChildProcess | undefined> {
        return new Promise<ChildProcess | undefined>(
            (resolve, reject) => {
                try {
                    const serviceRoot = getPackageFilePath("./node_modules/image-memory/dist/service.js");                    
                    const childProcess = fork(serviceRoot);
    
                    childProcess.on("message", function (message) {
                        if (message === "Success") {
                            resolve(childProcess);
                        } else if (message === "Failure") {
                            resolve(undefined);
                        } else {

                            // const mon: PhotoMontage | undefined =
                            //     message as PhotoMontage;
                            // if (mon) {
                            //     montageUpdatedCallback(mon);
                            // }
                        }
                    });
    
                    childProcess.on("exit", (code) => {
                        debug("Montage view server exited with code:", code);
                    });
                } catch (e: any) {
                    console.error(e);
                    resolve(undefined);
                }
            },
        );
    }
}
