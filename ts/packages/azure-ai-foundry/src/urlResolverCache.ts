// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import { isDirectoryPath } from "typeagent";
import zlib from "zlib";
import registerDebug from "debug";

const debug = registerDebug("typeagent:azure-ai-foundry:urlResolverCache");

export type domainCache = {
    [key: string]: domainData;
};

export type domainData = {
    dateIndexed: number;
    urlsFound: number;
};

export type urlCache = {
    [key: string]: urlData;
};

export type urlData = {
    phrases?: string[];
    title?: string;
};

export type phraseCache = {
    [key: string]: string[];
};

/**
 * The url resolver cache. Turns "open" phrases into URLs.
 */
export class UrlResolverCache {
    private cacheDir: string = "";
    private domainFile: string = "domains.json";
    private urlFile: string = "urls.json";
    private phrasesFile: string = "phrases.json";
    private compressed: boolean = false;

    public domains: domainCache = {};

    public urls: urlCache = {};

    public phrases: phraseCache = {};

    constructor(compressed?: boolean) {
        if (compressed) {
            this.compressed = compressed;
        }
    }

    /**
     * Loads the cache file
     * @param dir - The path to the cache file to load
     */
    public load(dir: string) {
        if (!isDirectoryPath(dir)) {
            mkdirSync(dir, { recursive: true });
            //throw new Error(`The directory ${dir} does not exist!`);
        }

        if (dir) {
            this.cacheDir = dir;
        }

        if (!existsSync(this.cacheDir)) {
            throw new Error(`The directory ${this.cacheDir} does not exist!`);
        }

        try {
            const domainsGz = path.join(this.cacheDir, `${this.domainFile}.gz`);
            const urlsGz = path.join(this.cacheDir, `${this.urlFile}.gz`);

            if (existsSync(domainsGz)) {
                const buf = readFileSync(domainsGz);
                this.domains = JSON.parse(
                    zlib.gunzipSync(buf).toString("utf-8"),
                );
            } else if (existsSync(path.join(this.cacheDir, this.domainFile))) {
                this.domains = JSON.parse(
                    readFileSync(
                        path.join(this.cacheDir, this.domainFile),
                        "utf-8",
                    ),
                );
            }

            if (existsSync(urlsGz)) {
                const buf = readFileSync(urlsGz);
                this.urls = JSON.parse(zlib.gunzipSync(buf).toString("utf-8"));
            } else if (existsSync(path.join(this.cacheDir, this.urlFile))) {
                this.urls = JSON.parse(
                    readFileSync(
                        path.join(this.cacheDir, this.urlFile),
                        "utf-8",
                    ),
                );
            }

            this.loadPhrases(dir);
        } catch (err) {
            throw new Error(
                `Failed to read compressed cache files: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /**
     * Loads the phrases cache file only
     * @param dir - The path to the cache file to load
     */
    public loadPhrases(dir: string) {
        if (dir) {
            this.cacheDir = dir;
        }

        // TODO: make async
        if (!existsSync(this.cacheDir)) {
            debug(`The directory ${this.cacheDir} does not exist!`);

            return;
        }

        try {
            const phrasesGz = path.join(
                this.cacheDir,
                `${this.phrasesFile}.gz`,
            );

            if (existsSync(phrasesGz)) {
                const buf = readFileSync(phrasesGz);
                this.phrases = JSON.parse(
                    zlib.gunzipSync(buf).toString("utf-8"),
                );
            } else if (existsSync(path.join(this.cacheDir, this.phrasesFile))) {
                this.phrases = JSON.parse(
                    readFileSync(
                        path.join(this.cacheDir, this.phrasesFile),
                        "utf-8",
                    ),
                );
            }
        } catch (err) {
            throw new Error(
                `Failed to read compressed cache files: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /**
     * Saves the uncompressed cache with all associated meta data.
     */
    public save() {
        if (!existsSync(this.cacheDir)) {
            try {
                mkdirSync(this.cacheDir, { recursive: true });
            } catch (err) {
                throw new Error(
                    `Failed to create cache directory '${this.cacheDir}': ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }

        try {
            const phrasesContent = JSON.stringify(this.phrases, null, 2);

            if (this.compressed) {
                writeFileSync(
                    path.join(this.cacheDir, `${this.phrasesFile}.gz`),
                    zlib.gzipSync(Buffer.from(phrasesContent, "utf-8")),
                );

                const domainsContent = JSON.stringify(this.domains, null, 2);
                writeFileSync(
                    path.join(this.cacheDir, `${this.domainFile}.gz`),
                    zlib.gzipSync(Buffer.from(domainsContent, "utf-8")),
                );

                const urlsContent = JSON.stringify(this.urls, null, 2);
                writeFileSync(
                    path.join(this.cacheDir, `${this.urlFile}.gz`),
                    zlib.gzipSync(Buffer.from(urlsContent, "utf-8")),
                );
            } else {
                writeFileSync(
                    path.join(this.cacheDir, `${this.phrasesFile}`),
                    phrasesContent,
                    "utf-8",
                );

                const domainsContent = JSON.stringify(this.domains, null, 2);
                writeFileSync(
                    path.join(this.cacheDir, `${this.domainFile}`),
                    domainsContent,
                    "utf-8",
                );

                const urlsContent = JSON.stringify(this.urls, null, 2);
                writeFileSync(
                    path.join(this.cacheDir, `${this.urlFile}`),
                    urlsContent,
                    "utf-8",
                );
            }
        } catch (err) {
            throw new Error(
                `Failed to write compressed cache files: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}
