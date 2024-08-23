// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DeepPartialUndefined } from "common-utils";
import { CacheConfig, AgentCache, getDefaultExplainerName } from "agent-cache";
import registerDebug from "debug";
import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import { getBuiltinConstructionConfig } from "../utils/config.js";
import { getTranslatorConfigs } from "../translation/agentTranslators.js";
import {
    ensureUserProfileDir,
    getUserProfileDir,
    getUniqueFileName,
    getYMDPrefix,
} from "../utils/userData.js";

const debugSession = registerDebug("typeagent:session");

type Sessions = {
    lastSession?: string;
};

function getSessionsFilePath() {
    return path.join(getUserProfileDir(), "sessions.json");
}

function getSessionsDirPath() {
    return path.join(getUserProfileDir(), "sessions");
}

function getSessionDirPath(dir: string) {
    return path.join(getSessionsDirPath(), dir);
}

function getSessionDataFilePath(dir: string) {
    return path.join(getSessionDirPath(dir), "data.json");
}

export function getSessionCacheDirPath(dir: string) {
    return path.join(getSessionDirPath(dir), "constructions");
}

let releaseLock: () => Promise<void> | undefined;

type ConfigObject = {
    [key: string]: any;
};

function mergeConfig(
    config: ConfigObject,
    options: ConfigObject,
    strict: boolean = true,
) {
    const changed: ConfigObject = {};
    const keys = strict ? Object.keys(config) : Object.keys(options);
    for (const key of keys) {
        const value = options[key];
        if (value !== undefined) {
            if (typeof value === "object") {
                if (config[key] === undefined) {
                    if (strict) {
                        continue;
                    }
                    config[key] = {};
                }

                const changedValue = mergeConfig(config[key], value, strict);
                if (Object.keys(changedValue).length !== 0) {
                    changed[key] = changedValue;
                }
            } else if (config[key] !== value) {
                config[key] = value;
                changed[key] = value;
            }
        }
    }
    return changed;
}

function cloneConfig(config: SessionConfig): SessionConfig {
    const clone: any = {};
    mergeConfig(clone, config, false);
    return clone;
}

async function loadSessions(): Promise<Sessions> {
    // If we ever load the session config, we lock it until the process exits
    if (releaseLock === undefined) {
        const userProfileDir = ensureUserProfileDir();
        try {
            let isExiting = false;
            process.on("exit", () => {
                isExiting = true;
            });
            releaseLock = await lockfile.lock(userProfileDir, {
                onCompromised: (err) => {
                    if (isExiting) {
                        // We are exiting, just ignore the error
                        return;
                    }
                    console.error(
                        `\nERROR: User profile lock ${userProfileDir} compromised. Only one client per profile can be active at a time.\n  ${err}`,
                    );
                    process.exit(-1);
                },
            });
        } catch (e) {
            console.error(
                `ERROR: Unable to lock profile ${userProfileDir}. Only one client per profile can be active at a time.`,
            );
            process.exit(-1);
        }
    }

    const sessionFilePath = getSessionsFilePath();
    if (fs.existsSync(sessionFilePath)) {
        const content = await fs.promises.readFile(sessionFilePath, "utf-8");
        return JSON.parse(content);
    }
    return {};
}

async function newSessionDir() {
    const sessions = await loadSessions();
    const dir = getUniqueFileName(getSessionsDirPath(), getYMDPrefix());
    const fullDir = getSessionDirPath(dir);
    await fs.promises.mkdir(fullDir, { recursive: true });
    sessions.lastSession = dir;
    await fs.promises.writeFile(
        getSessionsFilePath(),
        JSON.stringify(sessions, undefined, 2),
    );
    debugSession(`New session: ${dir}`);
    return dir;
}

type DispatcherConfig = {
    translators: ConfigObject;
    actions: ConfigObject;
    explainerName: string;
    models: {
        translator: string;
        explainer: string;
    };
    bot: boolean;
    stream: boolean;
    explanation: boolean;
    switch: {
        inline: boolean;
        search: boolean;
    };
    multipleActions: boolean;
    history: boolean;

    // Cache behaviors
    cache: boolean;
    builtInCache: boolean;
    autoSave: boolean;
    matchWildcard: boolean;
};

export type SessionConfig = DispatcherConfig & CacheConfig;

export const defaultSessionConfig: SessionConfig = {
    translators: Object.fromEntries(
        getTranslatorConfigs().map(([name, config]) => [
            name,
            config.defaultEnabled,
        ]),
    ),
    actions: Object.fromEntries(
        getTranslatorConfigs().map(([name, config]) => [
            name,
            config.actionDefaultEnabled,
        ]),
    ),
    explainerName: getDefaultExplainerName(),
    models: {
        translator: "",
        explainer: "",
    },
    bot: true,
    stream: true,
    explanation: true,
    switch: {
        inline: true,
        search: true,
    },
    multipleActions: true,
    history: true,
    cache: true,
    autoSave: true,
    mergeMatchSets: true, // the session default is different then the default in the cache
    cacheConflicts: true, // the session default is different then the default in the cache
    matchWildcard: true,
    builtInCache: true,
};

// explainer name as key, cache file path as value
type SessionCacheData = {
    [key: string]: string | undefined;
};

type SessionData = {
    config: SessionConfig;
    cacheData: SessionCacheData;
};

export type SessionOptions = DeepPartialUndefined<SessionConfig>;

// Fill in missing fields when loading sessions from disk
function ensureSessionData(data: any): SessionData {
    if (data.config === undefined) {
        data.config = {};
    }
    // Make sure the data we load from disk has all the fields,
    // and set it to the default value if it is missing.
    // Also clear extra flags.

    const existingData = data.config;
    data.config = cloneConfig(defaultSessionConfig);
    mergeConfig(data.config, existingData);

    if (data.cacheData === undefined) {
        data.cacheData = {};
    }
    return data;
}

const sessionVersion = 2;
async function readSessionData(dir: string) {
    const sessionDataFilePath = getSessionDataFilePath(dir);
    if (!fs.existsSync(sessionDataFilePath)) {
        throw new Error(`Session '${dir}' does not exist.`);
    }
    const content = await fs.promises.readFile(sessionDataFilePath, "utf-8");
    const data = JSON.parse(content);
    if (data.version !== sessionVersion) {
        throw new Error(
            `Unsupported session version (${data.version}) in '${dir}'`,
        );
    }
    return ensureSessionData(data);
}

export class Session {
    private config: SessionConfig;
    private cacheData: SessionCacheData;

    public static async create(config: SessionConfig, persist: boolean) {
        const session = new Session(
            { config: cloneConfig(config), cacheData: {} },
            persist ? await newSessionDir() : undefined,
        );
        await session.save();
        return session;
    }

    public static async load(dir: string) {
        const sessionData = await readSessionData(dir);
        debugSession(`Loading session: ${dir}`);
        return new Session(sessionData, dir);
    }

    public static async restoreLastSession() {
        const sessionDir = (await loadSessions())?.lastSession;
        if (sessionDir !== undefined) {
            try {
                return this.load(sessionDir);
            } catch (e: any) {
                throw new Error(
                    `Unable to restore last session '${sessionDir}': ${e.message}`,
                );
            }
        }
        return undefined;
    }

    private constructor(
        sessionData: SessionData,
        public readonly dir?: string,
    ) {
        this.config = sessionData.config;
        this.cacheData = sessionData.cacheData;
    }

    public get useTranslators() {
        return Object.entries(this.config.translators)
            .filter(([, value]) => value)
            .map(([name]) => name);
    }
    public get explainerName() {
        return this.config.explainerName;
    }

    public get bot() {
        return this.config.bot;
    }

    public get explanation() {
        return this.config.explanation;
    }

    public get cache() {
        return this.config.cache;
    }

    public get autoSave() {
        return this.config.autoSave;
    }

    public get builtInCache() {
        return this.config.builtInCache;
    }

    public get cacheConfig(): CacheConfig {
        return {
            mergeMatchSets: this.config.mergeMatchSets,
            cacheConflicts: this.config.cacheConflicts,
        };
    }

    public getConfig(): SessionConfig {
        return this.config;
    }

    public setConfig(options: SessionOptions): SessionOptions {
        const changed = mergeConfig(this.config, options);
        if (Object.keys(changed).length > 0) {
            this.save();
        }
        return changed;
    }

    public getSessionDirPath(): string | undefined {
        return this.dir ? getSessionDirPath(this.dir) : undefined;
    }

    public getCacheDataFilePath() {
        const filePath = this.cacheData[this.explainerName];

        return filePath && this.dir && !path.isAbsolute(filePath)
            ? path.join(getSessionCacheDirPath(this.dir), filePath)
            : filePath;
    }

    public setCacheDataFilePath(
        filePath: string | undefined,
        explainerName?: string,
    ) {
        const filePathRel =
            filePath &&
            this.dir &&
            path.isAbsolute(filePath) &&
            filePath.startsWith(getSessionCacheDirPath(this.dir))
                ? path.relative(getSessionCacheDirPath(this.dir), filePath)
                : filePath;

        this.cacheData[explainerName ?? this.explainerName] = filePathRel;

        this.save();
    }

    public async ensureCacheDataFilePath() {
        const filePath = this.getCacheDataFilePath();
        return filePath ?? this.newCacheDataFilePath();
    }

    public async clear() {
        if (this.dir) {
            const sessionDir = getSessionDirPath(this.dir);
            await fs.promises.rm(sessionDir, { recursive: true, force: true });
            await fs.promises.mkdir(sessionDir, { recursive: true });
            this.cacheData = {};
            await this.save();
        }
    }

    private async newCacheDataFilePath() {
        if (this.dir) {
            const cacheDirPath = getSessionCacheDirPath(this.dir);
            await fs.promises.mkdir(cacheDirPath, { recursive: true });
            const filePath = getUniqueFileName(
                cacheDirPath,
                `${this.explainerName}_${getYMDPrefix()}`,
                ".json",
            );
            this.setCacheDataFilePath(filePath);
            return path.join(cacheDirPath, filePath);
        }
        return undefined;
    }

    private save() {
        if (this.dir) {
            const sessionDataFilePath = getSessionDataFilePath(this.dir);
            const data = {
                version: sessionVersion,
                config: this.config,
                cacheData: this.cacheData,
            };
            fs.writeFileSync(
                sessionDataFilePath,
                JSON.stringify(data, undefined, 2),
            );
        }
    }
}

export async function configAgentCache(
    session: Session,
    agentCache: AgentCache,
) {
    agentCache.model = session.getConfig().models.explainer;
    agentCache.constructionStore.clear();
    if (session.cache) {
        const cacheData = session.getCacheDataFilePath();
        if (cacheData !== undefined) {
            // Load if there is an existing path.
            if (fs.existsSync(cacheData)) {
                debugSession(`Loading session cache from ${cacheData}`);
                await agentCache.constructionStore.load(cacheData);
            } else {
                debugSession(`Cache file missing ${cacheData}`);
                // Disable the cache if we can't load the file.
                session.setConfig({ cache: false });
                throw new Error(
                    `Cache file ${cacheData} missing. Use '@const new' to create a new one'`,
                );
            }
        } else {
            // Create if there isn't an existing path.
            const newCacheData = session.autoSave
                ? await session.ensureCacheDataFilePath()
                : undefined;
            await agentCache.constructionStore.newCache(newCacheData);
            debugSession(`Creating session cache ${newCacheData ?? ""}`);
        }

        if (session.builtInCache) {
            const builtInConstructions = session.builtInCache
                ? getBuiltinConstructionConfig(session.explainerName)?.file
                : undefined;

            try {
                await agentCache.constructionStore.setBuiltInCache(
                    builtInConstructions,
                );
            } catch (e: any) {
                console.warn(
                    `WARNING: Unable to load built-in cache: ${e.message}`,
                );
            }
        }
    }
    await agentCache.constructionStore.setAutoSave(session.autoSave);
}

export async function deleteSession(dir: string) {
    if (dir === "") {
        return;
    }
    const sessionDir = getSessionDirPath(dir);
    return fs.promises.rm(sessionDir, { recursive: true, force: true });
}

export async function deleteAllSessions() {
    const sessionsDir = getSessionsDirPath();
    return fs.promises.rm(sessionsDir, { recursive: true, force: true });
}

export async function getSessionNames() {
    const sessionsDir = getSessionsDirPath();
    const dirent = await fs.promises.readdir(sessionsDir, {
        withFileTypes: true,
    });
    return dirent.filter((d) => d.isDirectory()).map((d) => d.name);
}

export async function getSessionCaches(dir: string) {
    const cacheDir = getSessionCacheDirPath(dir);
    const dirent = await fs.promises.readdir(cacheDir, { withFileTypes: true });
    const sessionCacheData = (await readSessionData(dir))?.cacheData;
    const ret: {
        explainer: string;
        name: string;
        current: boolean;
    }[] = [];
    for (const d of dirent) {
        if (!d.isFile()) {
            continue;
        }

        try {
            const cacheContent = await fs.promises.readFile(
                path.join(cacheDir, d.name),
                "utf-8",
            );
            const cacheData = JSON.parse(cacheContent);
            ret.push({
                explainer: cacheData.explainerName,
                name: d.name,
                current: sessionCacheData?.[cacheData.explainerName] === d.name,
            });
        } catch {
            // ignore errors
        }
    }

    return ret;
}
