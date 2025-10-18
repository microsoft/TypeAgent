// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import registerDebug from "debug";
import { Construction, MatchResult } from "../constructions/constructions.js";
import { ExplanationData } from "../explanation/explanationData.js";
import { importConstructions } from "../constructions/importConstructions.js";
import { CacheConfig, CacheOptions } from "./cache.js";
import { ExplainerFactory } from "./factory.js";
import { SchemaInfoProvider } from "../explanation/schemaInfoProvider.js";
import { ConstructionCache } from "../indexBrowser.js";
import {
    MatchOptions,
    NamespaceKeyFilter,
} from "../constructions/constructionCache.js";
import {
    PrintOptions,
    printConstructionCache,
} from "../constructions/constructionPrint.js";

const debugConstMatch = registerDebug("typeagent:const:match");

const defaultConfig: CacheConfig = {
    mergeMatchSets: false,
    cacheConflicts: false,
};

export async function loadConstructionCacheFile(constructionFilePath: string) {
    if (!fs.existsSync(constructionFilePath)) {
        throw new Error(`File '${constructionFilePath}' does not exist.`);
    }

    const data = await fs.promises.readFile(constructionFilePath, "utf8");
    if (data === "") {
        // empty file to indicate an new/empty cache.
        return undefined;
    }
    return ConstructionCache.fromJSON(JSON.parse(data));
}

async function loadConstructionCache(
    constructionFilePath: string,
    explainerName: string,
) {
    const cache = await loadConstructionCacheFile(constructionFilePath);
    if (cache === undefined) {
        // empty file to indicate an new/empty cache.
        return new ConstructionCache(explainerName);
    }
    if (cache.explainerName !== explainerName) {
        throw new Error(
            `Construction cache '${constructionFilePath}' is for explainer '${cache.explainerName}', not '${explainerName}'`,
        );
    }
    return cache;
}

type ConstructionStoreInfo = {
    filePath: string | undefined;
    modified: boolean;
    constructionCount: number;
    filteredConstructionCount: number;
    builtInCacheFilePath: string | undefined;
    builtInConstructionCount: number | undefined;
    filteredBuiltInConstructionCount: number | undefined;
    config: CacheConfig;
};

export interface ConstructionStore {
    // States
    isEnabled(): boolean;
    isModified(): boolean;
    getFilePath(): string | undefined;

    // Config
    getConfig(): CacheConfig;
    setConfig(options: CacheOptions): void;
    isAutoSave(): boolean;
    setAutoSave(autoSave: boolean): Promise<void>;
    setBuiltInCache(builtInCacheFilePath: string | undefined): Promise<void>;

    // Operations
    newCache(filePath?: string, defaultConst?: boolean): Promise<void>;
    load(filePath?: string): Promise<void>;
    save(filePath?: string): Promise<boolean>;
    clear(): void;

    print(options: PrintOptions): void;

    // Editing
    delete(schemaName: string, id: number): Promise<void>;

    // Usage
    match(request: string, options?: MatchOptions): MatchResult[];

    // Completion
    getPrefix(namespaceKeys?: string[]): string[];
}

export class ConstructionStoreImpl implements ConstructionStore {
    private cache: ConstructionCache | undefined = undefined;
    private builtInCache: ConstructionCache | undefined = undefined;
    private builtInCacheFilePath: string | undefined = undefined;
    private modified: boolean = false;
    private filePath: string | undefined = undefined;

    // Configs
    private autoSave: boolean = false;
    private config: CacheConfig;

    constructor(
        private readonly explainerName: string,
        cacheOptions?: CacheOptions,
    ) {
        this.config = { ...defaultConfig };
        if (cacheOptions) {
            this.setConfig(cacheOptions);
        }
    }

    private ensureCache() {
        if (this.cache === undefined) {
            return this.createCache();
        }
        return this.cache;
    }
    private createCache() {
        this.cache = new ConstructionCache(this.explainerName);
        return this.cache;
    }

    public isEnabled() {
        return this.cache !== undefined;
    }

    public isModified() {
        return this.modified;
    }

    public getFilePath() {
        return this.filePath;
    }

    public isAutoSave() {
        return this.autoSave && this.filePath !== undefined;
    }

    private doAutoSave() {
        if (this.isAutoSave()) {
            return this.save();
        }
    }

    public getConfig(): CacheConfig {
        return { ...this.config };
    }
    public setConfig(options: CacheOptions) {
        const changed: CacheOptions = {};
        const keys = Object.keys(defaultConfig) as (keyof CacheConfig)[];
        for (const key of keys) {
            const value = options[key];
            if (value !== undefined && this.config[key] !== value) {
                (this.config[key] as any) = value;
                (changed[key] as any) = value;
            }
        }
        return changed;
    }

    public async setBuiltInCache(builtInCacheFilePath: string | undefined) {
        this.builtInCache =
            builtInCacheFilePath !== undefined
                ? await loadConstructionCache(
                      builtInCacheFilePath,
                      this.explainerName,
                  )
                : undefined;

        this.builtInCacheFilePath = builtInCacheFilePath;
    }

    public async newCache(filePath?: string) {
        this.createCache();
        this.modified = !!filePath;
        this.filePath = filePath;
        await this.doAutoSave();
    }

    public async import(
        data: ExplanationData[],
        getExplainer: ExplainerFactory,
        schemaInfoProvider?: SchemaInfoProvider,
        ignoreSourceHash: boolean = false,
    ) {
        const cache = this.ensureCache();
        const result = importConstructions(
            data,
            cache,
            getExplainer,
            this.config.mergeMatchSets,
            this.config.cacheConflicts,
            schemaInfoProvider,
            ignoreSourceHash,
        );
        this.modified = true;
        const p = this.doAutoSave();

        // Not strictly necessary, but good for have consistent timing when construction match a construction
        cache.forceRegexp();

        await p;
        return result;
    }

    public async load(filePath: string) {
        const constructionFilePath = path.resolve(filePath);
        this.cache = await loadConstructionCache(
            constructionFilePath,
            this.explainerName,
        );
        this.modified = false;
        this.filePath = constructionFilePath;
    }

    public async save(filePath?: string) {
        const outFile = filePath ? path.resolve(filePath) : this.filePath;
        if (outFile === undefined) {
            throw new Error("No output file specified");
        }

        if (this.cache === undefined) {
            throw new Error("Construction cache not initialized");
        }
        if (outFile === this.filePath && this.modified === false) {
            return false;
        }

        const dir = path.dirname(outFile);
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
        await fs.promises.writeFile(
            outFile,
            JSON.stringify(this.cache, undefined, 2),
        );

        this.filePath = outFile;
        this.modified = false;
        return true;
    }

    public async setAutoSave(autoSave: boolean) {
        this.autoSave = autoSave;
        if (this.filePath !== undefined && autoSave) {
            await this.save();
        }
    }

    public clear() {
        this.cache = undefined;
        this.builtInCache = undefined;
        this.builtInCacheFilePath = undefined;
        this.modified = false;
        this.filePath = undefined;
    }

    public async delete(namespace: string, id: number) {
        if (this.cache === undefined) {
            throw new Error("Construction cache not initialized");
        }
        const count = this.cache.delete(namespace, id);

        if (count === -1) {
            throw new Error(`Invalid cache namespace '${namespace}'.`);
        }
        if (count === 0) {
            throw new Error(
                `Construction ${id} not found in cache namespace '${namespace}'.`,
            );
        }
        this.modified = true;
        await this.doAutoSave();
    }

    public getInfo(
        filter?: NamespaceKeyFilter,
    ): ConstructionStoreInfo | undefined {
        if (this.cache === undefined) {
            return undefined;
        }

        const constructionCount = this.cache.count;
        const builtInConstructionCount = this.builtInCache?.count;
        return {
            filePath: this.filePath,
            modified: this.modified,
            constructionCount: this.cache.count,
            filteredConstructionCount: filter
                ? this.cache.getFilteredCount(filter)
                : constructionCount,
            builtInCacheFilePath: this.builtInCacheFilePath,
            builtInConstructionCount,
            filteredBuiltInConstructionCount: filter
                ? this.builtInCache?.getFilteredCount(filter)
                : builtInConstructionCount,
            config: this.getConfig(),
        };
    }

    public print(options: PrintOptions) {
        const cache = options.builtin ? this.builtInCache : this.cache;
        if (cache === undefined) {
            throw new Error(
                `${
                    options.builtin ? "Built-in construction" : "Construction"
                } cache not initialized`,
            );
        }
        printConstructionCache(cache, options);
    }

    /**
     * Add a construction to the cache
     * @param namespaceKeys separate the construction based on the schema name and hash in the action.  Used to quickly enable/disable construction based on translator is enabled
     * @param construction the construction to add
     * @returns the result of the construction addition
     */
    public async addConstruction(
        namespaceKeys: string[],
        construction: Construction,
    ) {
        if (this.cache === undefined) {
            throw new Error("Construction cache not initialized");
        }

        const result = this.cache.addConstruction(
            namespaceKeys,
            construction,
            this.config.mergeMatchSets,
            this.config.cacheConflicts,
        );

        this.modified = true;
        const p = this.doAutoSave();

        if (result.added) {
            // Not strictly necessary, but good for have consistent timing when construction match a construction
            this.cache.forceRegexp();
        }

        await p;
        return result;
    }

    /**
     * Try to match the request and transform it into action using constructions
     *
     * @param request The request to match
     * @param options Options to control the match
     * @returns All possible matches sorted by some heuristics of the likeliest match
     */
    public match(request: string, options?: MatchOptions) {
        if (this.cache === undefined) {
            throw new Error("Construction cache not initialized");
        }
        let matches = this.cache.match(request, options);
        if (matches.length === 0 && this.builtInCache !== undefined) {
            matches = this.builtInCache.match(request, options);
        }
        if (debugConstMatch.enabled) {
            debugConstMatch(
                `Found ${matches.length} construction(s) for '${request}':`,
            );
            for (let i = 0; i < matches.length; i++) {
                const match = matches[i];
                const actionStr = chalk.green(match.match.actions);
                const constructionStr = chalk.grey(`(${match.construction})`);
                const message = [
                    `[${i.toString().padStart(3)}]       Action: ${actionStr}`,
                    `             Const: [${match.construction.id}]${constructionStr}`,
                    `    Implicit Count: ${match.construction.implicitParameterCount}`,
                    `Non Optional Count: ${match.nonOptionalCount}`,
                    `     Matched Count: ${match.matchedCount}`,
                    `   Wild Char Count: ${match.wildcardCharCount}`,
                ];
                debugConstMatch(message.join("\n"));
            }
        }
        return matches;
    }

    public async prune(filter: (namespaceKey: string) => boolean) {
        if (this.cache === undefined) {
            throw new Error("Construction cache not initialized");
        }

        const count = this.cache.prune(filter);
        this.modified = true;
        await this.doAutoSave();
        return count;
    }

    public getPrefix(namespaceKeys?: string[]): string[] {
        if (this.cache === undefined) {
            throw new Error("Construction cache not initialized");
        }
        return this.cache.getPrefix(namespaceKeys);
    }
}
