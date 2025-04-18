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
    location: string,    // the location that has been index
    size: number,        // the # of items in the index
    path: string,        // the path to the index
    state: "new" | "running" | "finished" | "stopped" | "error" // the state of the indexing service for this index
}

/*
* IndexManager is a singleton class that manages the indexes for the system.
*/
export class IndexManager {
    private static instance: IndexManager;
    private indexingServices: Map<IndexData, ChildProcess | undefined> = new Map<IndexData, ChildProcess | undefined>();

    public static getInstance = (): IndexManager => {
        if (!IndexManager.instance) {
            IndexManager.instance = new IndexManager();
        }
        return IndexManager.instance;
    }

    /*
    * Loads the supplied indexes
    */
    public static load(indexesToLoad: IndexData[]) {
        indexesToLoad.forEach((value) => {

            // TODO: does this index need to be updated
            // if so start a new indexing service and save it here

            // TODO: parse, get their status, resume indexing, setup monitors, etc.

            this.getInstance().indexingServices.set(value, undefined);
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
    public async createIndex(name: string, source: IndexSource, location: string): Promise<boolean> {

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

        const index: IndexData = {
            source: "image",
            name,
            location,
            size: 0,
            path: folder,
            state: "new"
        };

        // TODO: start indexing
        this.startIndexingService(index);
        // .then((childProc: ChildProcess | undefined) => {
        //     this.indexingServices.set(index, childProc);
        //     childProc?.send(index);
        // });
    }

    public deleteIndex(name: string): boolean {
        
        // TODO: stop indexing
        this.indexingServices.forEach((childProc, index) => {
            if (index.name == name) {
                // kill the index process
                childProc?.kill();

                // remove the index from the list of indexes
                this.indexingServices.delete(index);

                // remove the folder where the index is stored
                fs.promises.rm(index.path, { recursive: true, force: true }).catch((reason) => debug(reason));                
            }
        });

        return true;
    }

    private startIndexingService(index: IndexData): Promise<ChildProcess | undefined> {
        return new Promise<ChildProcess | undefined>(
            (resolve, reject) => {
                try {
                    const serviceRoot = getPackageFilePath("./node_modules/image-memory/dist/indexingService.js");                    
                    const childProcess = fork(serviceRoot);
    
                    childProcess.on("message", function (message) {
                        if (message === "Success") {
                            childProcess.send(index);
                            resolve(childProcess);
                        } else if (message === "Failure") {
                            index.state = "error";
                            resolve(undefined);
                        } else {

                            // TODO: handle index progres/status updates
                        }
                    });
    
                    childProcess.on("exit", (code) => {
                        debug(`Index service ${index.name} exited with code:`, code);
                    });
                } catch (e: any) {
                    console.error(e);
                    resolve(undefined);
                }
            },
        );
    }
}
