// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DeepPartialUndefined } from "common-utils";
import { CacheConfig, AgentCache, getDefaultExplainerName } from "agent-cache";
import registerDebug from "debug";
import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import { getBuiltinConstructionConfig } from "../utils/config.js";
import {
    ensureUserProfileDir,
    getUserProfileDir,
    getUniqueFileName,
    getYMDPrefix,
} from "../utils/userData.js";
import ExifReader from "exifreader";
import {
    AppAgentState,
    AppAgentStateOptions,
} from "../handlers/common/appAgentManager.js";
import { cloneConfig, mergeConfig } from "./options.js";
import { TokenCounter, TokenCounterData } from "aiclient";

const debugSession = registerDebug("typeagent:session");

type Sessions = {
    lastSession?: string;
};

function getSessionsFilePath() {
    return path.join(getUserProfileDir(), "sessions.json");
}

export function getSessionsDirPath() {
    return path.join(getUserProfileDir(), "sessions");
}

export function getSessionDirPath(dir: string) {
    return path.join(getSessionsDirPath(), dir);
}

function getSessionDataFilePath(dir: string) {
    return path.join(getSessionDirPath(dir), "data.json");
}

export function getSessionCacheDirPath(dir: string) {
    return path.join(getSessionDirPath(dir), "constructions");
}

let releaseLock: () => Promise<void> | undefined;

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
    explainerName: string;
    models: {
        translator: string;
        explainer: string;
    };
    bot: boolean;
    stream: boolean;
    explanation: boolean;
    explanationOptions: {
        rejectReferences: boolean;
        retranslateWithoutContext: boolean;
    };
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

export type SessionConfig = AppAgentState & DispatcherConfig & CacheConfig;

export type SessionOptions = AppAgentStateOptions &
    DeepPartialUndefined<DispatcherConfig> &
    DeepPartialUndefined<CacheConfig>;

const defaultSessionConfig: SessionConfig = {
    translators: undefined,
    actions: undefined,
    commands: undefined,
    explainerName: getDefaultExplainerName(),
    models: {
        translator: "",
        explainer: "",
    },
    bot: true,
    stream: true,
    explanation: true,
    explanationOptions: {
        rejectReferences: true,
        retranslateWithoutContext: true,
    },
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

export function getDefaultSessionConfig() {
    return defaultSessionConfig;
}

// explainer name as key, cache file path as value
type SessionCacheData = {
    [key: string]: string | undefined;
};

type SessionData = {
    config: SessionConfig;
    cacheData: SessionCacheData;
    tokens?: TokenCounterData;
};

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
    mergeConfig(data.config, existingData, true, flexKeys);

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

const flexKeys = ["translators", "actions", "commands"];
export class Session {
    private config: SessionConfig;
    private cacheData: SessionCacheData;

    public static async create(
        config: SessionConfig = defaultSessionConfig,
        persist: boolean,
    ) {
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
        debugSession(
            `Config: ${JSON.stringify(sessionData.config, undefined, 2)}`,
        );

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

        // rehydrate token stats
        if (sessionData.tokens) {
            TokenCounter.load(sessionData.tokens);
        }
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

    public getConfig(): Readonly<SessionConfig> {
        return this.config;
    }

    public setConfig(options: SessionOptions): SessionOptions {
        const changed = mergeConfig(this.config, options, true, flexKeys);
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

    public save() {
        if (this.dir) {
            const sessionDataFilePath = getSessionDataFilePath(this.dir);
            const data = {
                version: sessionVersion,
                config: this.config,
                cacheData: this.cacheData,
                tokens: TokenCounter.getInstance(),
            };
            debugSession(`Saving session: ${this.dir}`);
            debugSession(
                `Config: ${JSON.stringify(data.config, undefined, 2)}`,
            );
            fs.writeFileSync(
                sessionDataFilePath,
                JSON.stringify(data, undefined, 2),
            );
        }
    }

    public async storeUserSuppliedFile(
        file: string,
    ): Promise<[string, ExifReader.Tags]> {
        const sessionDir = getSessionDirPath(this.dir as string);
        const filesDir = path.join(sessionDir, "user_files");
        await fs.promises.mkdir(filesDir, { recursive: true });

        // get the extension for the  mime type for the supplied file
        const fileExtension: string = this.getFileExtensionForMimeType(
            file.substring(5, file.indexOf(";")),
        );
        const uniqueFileName: string = getUniqueFileName(
            filesDir,
            "attachment_",
            fileExtension,
        );
        const fileName: string = path.join(filesDir, uniqueFileName);
        const buffer = Buffer.from(
            file.substring(file.indexOf(";base64,") + ";base64,".length),
            "base64",
        );

        const tags: ExifReader.Tags = ExifReader.load(buffer);

        fs.writeFile(fileName, buffer, () => {});

        return [uniqueFileName, tags];
    }

    getFileExtensionForMimeType(mime: string): string {
        switch (mime) {
            case "image/png":
                return ".png";
            case "image/jpeg":
                return ".jpeg";
        }

        throw "Unsupported MIME type"!;
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
