// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess, fork } from "node:child_process";
import fs, { existsSync } from "node:fs";
import registerDebug from "debug";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";

const debug = registerDebug("typeagent:indexManager");

export type IndexSource = "images" | "email";

export type IndexData = {
    source: IndexSource,// the data source of the index
    name: string,       // the name of the index 
    location: string    // the location that has been index
    size: number        // the # of items in the index
    files: string[];    // the files that constitute the index
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

    public async createIndex(name: string, source: IndexSource, location: string): Promise<boolean> {

        // make sure we're loaded
        this.indexingService = await Promise.resolve(this.indexingServicePromise);

        // TODO: implement

        switch (source) {
            case "images":
                this.createImageIndex(name, location);
                break;
            case "email":
                throw new Error("Email indexing is not implemented yet.");
            default:
                throw new Error(`Unknown index source: ${source}`);
        }

        return true;
    }

    private createImageIndex(name: string, location: string) {
        if (!existsSync(location)) {
            throw new Error(`Location ${location} does not exist.`);
        }

        this.idx.push({
            source: "images",
            name,
            location,
            size: 0,    // TODO: implement size calculation
            files: []   // TODO: populate when the index has been created
        });

        // TODO: start indexing
        this.indexingService?.send({ start: true });
    }

    public deleteIndex(name: string): boolean {
        
        // TODO: stop indexing

        this.idx.filter((index: IndexData) => index.name === name).forEach((index: IndexData) => {
            this.idx.splice(this.idx.indexOf(index), 1);

            index.files.forEach((file: string) => {                 
                fs.rmSync(index.location)
            });
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
