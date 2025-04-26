// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DeepPartialUndefined } from "common-utils";
import { CacheConfig, AgentCache, getDefaultExplainerName } from "agent-cache";
import registerDebug from "debug";
import fs from "node:fs";
import path from "node:path";
import { getUniqueFileName, getYMDPrefix } from "../utils/userData.js";
import ExifReader from "exifreader";
import { AppAgentState, AppAgentStateOptions } from "./appAgentManager.js";
import { cloneConfig, mergeConfig } from "./options.js";
import { TokenCounter, TokenCounterData } from "aiclient";
import { DispatcherName } from "./dispatcher/dispatcherUtils.js";
import { ConstructionProvider } from "../agentProvider/agentProvider.js";
import { MultipleActionConfig } from "../translation/multipleActionSchema.js";

const debugSession = registerDebug("typeagent:session");

type Sessions = {
    lastSession?: string;
};

function getSessionsFilePath(instanceDir: string) {
    return path.join(instanceDir, "sessions.json");
}

export function getSessionsDirPath(instanceDir: string) {
    return path.join(instanceDir, "sessions");
}

export function getSessionDirPath(instanceDir: string, dir: string) {
    return path.join(getSessionsDirPath(instanceDir), dir);
}

function getSessionDataFilePath(sessionDirPath: string) {
    return path.join(sessionDirPath, "data.json");
}

export function getSessionConstructionDirPath(sessionDirPath: string) {
    return path.join(sessionDirPath, "constructions");
}

async function loadSessions(instanceDir: string): Promise<Sessions> {
    const sessionFilePath = getSessionsFilePath(instanceDir);
    if (fs.existsSync(sessionFilePath)) {
        const content = await fs.promises.readFile(sessionFilePath, "utf-8");
        return JSON.parse(content);
    }
    return {};
}

async function newSessionDir(instanceDir: string) {
    const sessions = await loadSessions(instanceDir);
    const dir = getUniqueFileName(
        getSessionsDirPath(instanceDir),
        getYMDPrefix(),
    );
    const fullDir = getSessionDirPath(instanceDir, dir);
    await fs.promises.mkdir(fullDir, { recursive: true });
    sessions.lastSession = dir;
    await fs.promises.writeFile(
        getSessionsFilePath(instanceDir),
        JSON.stringify(sessions, undefined, 2),
    );
    debugSession(`New session: ${dir}`);
    return fullDir;
}

type DispatcherConfig = {
    request: string;
    translation: {
        enabled: boolean;
        model: string;
        stream: boolean;
        promptConfig: {
            additionalInstructions: boolean;
        };
        switch: {
            embedding: boolean; // use embedding to determine the first schema to use.
            inline: boolean;
            search: boolean;
        };
        multiple: MultipleActionConfig;
        history: {
            enabled: boolean;
            limit: number;
        };
        schema: {
            generation: {
                enabled: boolean;
                jsonSchema: boolean;
                jsonSchemaFunction: boolean;
                jsonSchemaWithTs: boolean; // only applies when jsonSchema or jsonSchemaFunction is true
                jsonSchemaValidate: boolean; // only applies when jsonSchema or jsonSchemaFunction is true
            };
            optimize: {
                enabled: boolean;
                numInitialActions: number; // 0 means no limit
            };
        };
    };
    execution: {
        history: boolean;
    };
    explainer: {
        enabled: boolean;
        model: string;
        name: string;
        filter: {
            multiple: boolean;
            reference: {
                value: boolean;
                list: boolean;
                translate: boolean;
            };
        };
    };

    // Cache behaviors
    cache: CacheConfig & {
        enabled: boolean;
        autoSave: boolean;
        builtInCache: boolean;
        matchWildcard: boolean;
    };
};

export type SessionConfig = AppAgentState & DispatcherConfig;

export type SessionOptions = AppAgentStateOptions &
    DeepPartialUndefined<DispatcherConfig>;

const defaultSessionConfig: SessionConfig = {
    schemas: undefined,
    actions: undefined,
    commands: undefined,

    // default to dispatcher
    request: DispatcherName,
    translation: {
        enabled: true,
        model: "",
        stream: true,
        promptConfig: {
            additionalInstructions: true,
        },
        switch: {
            embedding: true,
            inline: true,
            search: true,
        },
        multiple: {
            enabled: true,
            result: true,
            pending: true,
        },
        history: {
            enabled: true,
            limit: 20,
        },
        schema: {
            generation: {
                enabled: true,
                jsonSchema: false,
                jsonSchemaFunction: false,
                jsonSchemaWithTs: false,
                jsonSchemaValidate: true,
            },
            optimize: {
                enabled: false,
                numInitialActions: 5,
            },
        },
    },
    execution: {
        history: true,
    },
    explainer: {
        enabled: true,
        model: "",
        name: getDefaultExplainerName(),
        filter: {
            multiple: true,
            reference: {
                value: true,
                list: true,
                translate: true,
            },
        },
    },
    cache: {
        enabled: true,
        autoSave: true,
        mergeMatchSets: true, // the session default is different then the default in the cache
        cacheConflicts: true, // the session default is different then the default in the cache
        matchWildcard: true,
        builtInCache: true,
    },
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
    indicies?: IndexData;
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

export function getSessionName(dirPath: string) {
    return path.basename(dirPath);
}

const sessionVersion = 2;
async function readSessionData(dirPath: string) {
    const sessionDataFilePath = getSessionDataFilePath(dirPath);
    if (!fs.existsSync(sessionDataFilePath)) {
        const sessionName = getSessionName(dirPath);
        throw new Error(`Session '${sessionName}' does not exist.`);
    }
    const content = await fs.promises.readFile(sessionDataFilePath, "utf-8");
    const data = JSON.parse(content);
    if (data.version !== sessionVersion) {
        const sessionName = getSessionName(dirPath);
        throw new Error(
            `Unsupported session version (${data.version}) in '${sessionName}'`,
        );
    }
    return ensureSessionData(data);
}

const flexKeys = ["schemas", "actions", "commands"];
export class Session {
    private config: SessionConfig;
    private cacheData: SessionCacheData;

    public static async create(
        config: SessionConfig = defaultSessionConfig,
        instanceDir?: string,
    ) {
        const session = new Session(
            { config: cloneConfig(config), cacheData: {} },
            instanceDir ? await newSessionDir(instanceDir) : undefined,
        );
        await session.save();
        return session;
    }

    public static async load(instanceDir: string, dir: string) {
        const dirPath = getSessionDirPath(instanceDir, dir);
        const sessionData = await readSessionData(dirPath);
        debugSession(`Loading session: ${dir}`);
        debugSession(
            `Config: ${JSON.stringify(sessionData.config, undefined, 2)}`,
        );

        return new Session(sessionData, dirPath);
    }

    public static async restoreLastSession(instanceDir: string) {
        const sessionDir = (await loadSessions(instanceDir))?.lastSession;
        if (sessionDir !== undefined) {
            try {
                return this.load(instanceDir, sessionDir);
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
        public readonly sessionDirPath?: string,
    ) {
        this.config = sessionData.config;
        this.cacheData = sessionData.cacheData;

        // rehydrate token stats
        if (sessionData.tokens) {
            TokenCounter.load(sessionData.tokens);
        }
    }

    public get explainerName() {
        return this.config.explainer.name;
    }

    public get explanation() {
        return this.config.explainer.enabled;
    }

    public get cacheConfig(): CacheConfig {
        return {
            mergeMatchSets: this.config.cache.mergeMatchSets,
            cacheConflicts: this.config.cache.cacheConflicts,
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
        return this.sessionDirPath;
    }

    public getConstructionDataFilePath() {
        const filePath = this.cacheData[this.explainerName];

        return filePath && this.sessionDirPath && !path.isAbsolute(filePath)
            ? path.join(
                  getSessionConstructionDirPath(this.sessionDirPath),
                  filePath,
              )
            : filePath;
    }

    public setConstructionDataFilePath(
        filePath: string | undefined,
        explainerName?: string,
    ) {
        const filePathRel =
            filePath &&
            this.sessionDirPath &&
            path.isAbsolute(filePath) &&
            filePath.startsWith(
                getSessionConstructionDirPath(this.sessionDirPath),
            )
                ? path.relative(
                      getSessionConstructionDirPath(this.sessionDirPath),
                      filePath,
                  )
                : filePath;

        this.cacheData[explainerName ?? this.explainerName] = filePathRel;

        this.save();
    }

    public async ensureCacheDataFilePath() {
        const filePath = this.getConstructionDataFilePath();
        return filePath ?? this.newCacheDataFilePath();
    }

    public async clear() {
        if (this.sessionDirPath) {
            await fs.promises.rm(this.sessionDirPath, {
                recursive: true,
                force: true,
            });
            await fs.promises.mkdir(this.sessionDirPath, { recursive: true });
            this.cacheData = {};
            await this.save();
        }
    }

    private async newCacheDataFilePath() {
        if (this.sessionDirPath) {
            const cacheDirPath = getSessionConstructionDirPath(
                this.sessionDirPath,
            );
            await fs.promises.mkdir(cacheDirPath, { recursive: true });
            const filePath = getUniqueFileName(
                cacheDirPath,
                `${this.explainerName}_${getYMDPrefix()}`,
                ".json",
            );
            this.setConstructionDataFilePath(filePath);
            return path.join(cacheDirPath, filePath);
        }
        return undefined;
    }

    public save() {
        if (this.sessionDirPath) {
            const sessionDataFilePath = getSessionDataFilePath(
                this.sessionDirPath,
            );
            const data = {
                version: sessionVersion,
                config: this.config,
                cacheData: this.cacheData,
                tokens: TokenCounter.getInstance(),
            };
            debugSession(
                `Saving session: ${getSessionName(this.sessionDirPath)}`,
            );
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
        if (this.sessionDirPath === undefined) {
            throw new Error("Unable to store file without persisting session");
        }

        const filesDir = path.join(this.sessionDirPath, "user_files");
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

/**
 * Clear existing cache state and setup the cache again.
 */
export async function setupAgentCache(
    session: Session,
    agentCache: AgentCache,
    provider?: ConstructionProvider,
) {
    const config = session.getConfig();
    agentCache.model = config.explainer.model;
    agentCache.constructionStore.clear();
    if (config.cache.enabled) {
        const cacheData = session.getConstructionDataFilePath();
        if (cacheData !== undefined) {
            // Load if there is an existing path.
            if (fs.existsSync(cacheData)) {
                debugSession(`Loading session cache from ${cacheData}`);
                await agentCache.constructionStore.load(cacheData);
            } else {
                debugSession(`Cache file missing ${cacheData}`);
                // Disable the cache if we can't load the file.
                session.setConfig({ cache: { enabled: false } });
                throw new Error(
                    `Cache file ${cacheData} missing. Use '@const new' to create a new one'`,
                );
            }
        } else {
            // Create if there isn't an existing path.
            const newCacheData = config.cache.autoSave
                ? await session.ensureCacheDataFilePath()
                : undefined;
            await agentCache.constructionStore.newCache(newCacheData);
            debugSession(`Creating session cache ${newCacheData ?? ""}`);
        }

        await setupBuiltInCache(
            session,
            agentCache,
            config.cache.builtInCache,
            provider,
        );
    }
    await agentCache.constructionStore.setAutoSave(config.cache.autoSave);
}

export async function setupBuiltInCache(
    session: Session,
    agentCache: AgentCache,
    enable: boolean,
    provider?: ConstructionProvider,
) {
    const builtInConstructions = enable
        ? provider?.getBuiltinConstructionConfig(session.explainerName)?.file
        : undefined;

    try {
        await agentCache.constructionStore.setBuiltInCache(
            builtInConstructions,
        );
    } catch (e: any) {
        console.warn(`WARNING: Unable to load built-in cache: ${e.message}`);
    }
}

export async function deleteSession(instanceDir: string, dir: string) {
    if (dir === "") {
        return;
    }
    const sessionDir = getSessionDirPath(instanceDir, dir);
    return fs.promises.rm(sessionDir, { recursive: true, force: true });
}

export async function deleteAllSessions(instanceDir: string) {
    const sessionsDir = getSessionsDirPath(instanceDir);
    return fs.promises.rm(sessionsDir, { recursive: true, force: true });
}

export async function getSessionNames(instanceDir: string) {
    const sessionsDir = getSessionsDirPath(instanceDir);
    const dirent = await fs.promises.readdir(sessionsDir, {
        withFileTypes: true,
    });
    return dirent.filter((d) => d.isDirectory()).map((d) => d.name);
}

export async function getSessionConstructionDirPaths(dirPath: string) {
    const cacheDir = getSessionConstructionDirPath(dirPath);
    const dirent = await fs.promises.readdir(cacheDir, { withFileTypes: true });
    const sessionCacheData = (await readSessionData(dirPath))?.cacheData;
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
