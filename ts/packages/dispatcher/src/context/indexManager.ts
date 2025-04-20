// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess, fork } from "node:child_process";
import fs, { existsSync } from "node:fs";
import registerDebug from "debug";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { ensureDirectory, getUniqueFileName } from "../utils/fsUtils.js";
import path from "node:path";
import { ensureDir, isDirectoryPath } from "typeagent";
import { IndexData, IndexSource } from "image-memory";

const debug = registerDebug("typeagent:indexManager");

/*
* IndexManager is a singleton class that manages the indexes for the system.
*/
export class IndexManager {
    private static instance: IndexManager;
    private indexingServices: Map<IndexData, ChildProcess | undefined> = new Map<IndexData, ChildProcess | undefined>();
    private static rootPath: string;
    private cacheRoot: string;
    private imageRoot: string;
    private emailRoot: string;

    public static getInstance = (): IndexManager => {
        if (!IndexManager.instance) {
            IndexManager.instance = new IndexManager();
        }
        return IndexManager.instance;
    }

    private constructor() {
        ensureDirectory(IndexManager.rootPath);

        // make sure the indexes folder exists
        this.imageRoot = path.join(IndexManager.rootPath, "image")
        ensureDirectory(this.imageRoot);

        this.cacheRoot = path.join(IndexManager.rootPath, "cache");
        ensureDirectory(this.cacheRoot);

        this.emailRoot = path.join(IndexManager.rootPath, "email");
        ensureDirectory(this.emailRoot);  
    }

    /*
    * Loads the supplied indexes
    */
    public static load(indexesToLoad: IndexData[], sessionDir: string) {

        this.rootPath = path.join(sessionDir, "indexes");

        indexesToLoad.forEach((value) => {

            // restart any indexing that's not done
            if (value.state != "finished") {
                this.getInstance().startIndexingService(value).then((service) => {
                    this.getInstance().indexingServices.set(value, service);
                });
            }

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
            throw new Error(`Location '${location}' does not exist.`);
        }

        if (!isDirectoryPath(location)) {
            throw new Error (`Location '${location}' is not a directory.  Please specify a valid diretory.`);
        }

        const dirName = getUniqueFileName(this.imageRoot, "index");
        const folder = await ensureDir(path.join(this.imageRoot, dirName));

        const index: IndexData = {
            source: "image",
            name,
            location,
            size: 0,
            path: folder,
            state: "new"
        };

        // start indexing
        this.startIndexingService(index);
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
                            // TODO: handle index progres/status updates from the indexing service
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

