// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync, writeFileSync } from "fs";
import path from "path";

// type compressedUrlCache = {
//     temp: string;
// }

export type domainCache = {
    [key: string]: { 
        dateIndexed: number;
        urlsFound: number;
    }
}

export type urlCache = {
    [key: string]: {
        phrases?: string[];
        title?: string;
    };
}

/**
 * The url resolver cache. Turns "open" phrases into URLs.
 */
export class UrlResolverCache {

    private cacheFile: string = "";
    private domainFile: string = "domains.json";
    private urlFile: string = "urls.json";
    private phrasesFile: string = "cache.json"

    public domains: domainCache = {};

    public urls: urlCache = {};

    public phrases: {
        [key: string]: string[];
    } = {};

    constructor(file?: string) {
        if (file) {
            this.cacheFile = file;
        }
    }

    /**
     * Loads the cache file
     * @param file - The path to the cache file to load
     */
    public load(file: string) {

        if (!existsSync(file)) {
            throw new Error(`The file ${file} does not exist!`);
        }

        this.cacheFile = file;

        console.log(this.cacheFile);
        // load the compressed cache
        //const cc: compressedUrlCache = JSON.parse(readFileSync(this.cacheFile, "utf-8"));

        // reconstruct the human understandable cache
    }

    /**
     * Saves the uncompressed cache with all associated meta data.
     * @param outDir - The folder where the cache files should be written
     * @param fileNamePrefix - A file name prefix for the cache files
     */
    public save(outDir: string, fileNamePrefix?: string) {

        if (!existsSync(outDir)) {
            throw new Error (`The supplied path '${outDir} does not exist`);
        }

        writeFileSync(
            path.join(outDir, `${fileNamePrefix}${this.phrasesFile}`),
            JSON.stringify(this.phrases, null, 2),
        );
        writeFileSync(
            path.join(outDir, `${fileNamePrefix}${this.domainFile}`),
            JSON.stringify(this.domains, null, 2),
        );
        writeFileSync(
            path.join(outDir, `${fileNamePrefix}${this.urlFile}`),
            JSON.stringify(this.urls, null, 2),
        );

        // TODO: save compressed/.bin
    }
}