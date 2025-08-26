// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import { isDirectoryPath } from "typeagent";

// type compressedUrlCache = {
//     temp: string;
// }

export type domainCache = {
    [key: string]: domainData
}

export type domainData = { 
    dateIndexed: number;
    urlsFound: number;
}

export type urlCache = {
    [key: string]: urlData;
}

export type urlData = {
    phrases?: string[];
    title?: string;
};

export type phraseCache = {
    [key: string]: string[];
}

/**
 * The url resolver cache. Turns "open" phrases into URLs.
 */
export class UrlResolverCache {

    private cacheDir: string = "";
    private domainFile: string = "domains.json";
    private urlFile: string = "urls.json";
    private phrasesFile: string = "phrases.json"

    public domains: domainCache = {};

    public urls: urlCache = {};

    public phrases: phraseCache = {};

    constructor(dir: string) {

        if (!isDirectoryPath(dir)) {
            throw new Error(`The directory ${dir} does not exist!`);
        }

        if (dir) {
            this.cacheDir = dir;
        }
    }

    /**
     * Loads the cache file
     * @param file - The path to the cache file to load
     */
    public load(dir?: string) {

        if (dir) {
            this.cacheDir = dir
        }

        if (!existsSync(this.cacheDir)) {
            throw new Error(`The directory ${this.cacheDir} does not exist!`);
        }

        this.domains = JSON.parse(readFileSync(path.join(this.cacheDir, this.domainFile), "utf-8"));
        this.urls = JSON.parse(readFileSync(path.join(this.cacheDir, this.urlFile), "utf-8"));
        this.phrases = JSON.parse(readFileSync(path.join(this.cacheDir, this.phrasesFile), "utf-8"));
    }

    /**
     * Saves the uncompressed cache with all associated meta data.
     */
    public save() {

        if (!existsSync(this.cacheDir)) {
            try {
                mkdirSync(this.cacheDir, { recursive: true });
            } catch (err) {
                throw new Error(`Failed to create cache directory '${this.cacheDir}': ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        writeFileSync(
            path.join(this.cacheDir, `${this.phrasesFile}`),
            JSON.stringify(this.phrases, null, 2),
        );
        writeFileSync(
            path.join(this.cacheDir, `${this.domainFile}`),
            JSON.stringify(this.domains, null, 2),
        );
        writeFileSync(
            path.join(this.cacheDir, `${this.urlFile}`),
            JSON.stringify(this.urls, null, 2),
        );

        // TODO: save compressed/.bin
    }
}