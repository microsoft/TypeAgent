// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DeepPartialUndefined,
    DeepPartialUndefinedAndNull,
    getFileExtensionForMimeType,
} from "common-utils";
import { CacheConfig, AgentCache, getDefaultExplainerName } from "agent-cache";
import registerDebug from "debug";
import fs from "node:fs";
import path from "node:path";
import { getUniqueFileName, getYMDPrefix } from "../utils/fsUtils.js";
import ExifReader from "exifreader";
import {
    AppAgentStateConfig,
    appAgentStateKeys,
} from "./appAgentStateConfig.js";
import {
    cloneConfig,
    isEmptySettings,
    mergeConfig,
    sanitizeConfig,
} from "./options.js";
import { TokenCounter, TokenCounterData } from "aiclient";
import { DispatcherName } from "./dispatcher/dispatcherUtils.js";
import { ConstructionProvider } from "../agentProvider/agentProvider.js";
import { MultipleActionConfig } from "../translation/multipleActionSchema.js";
import { IndexManager } from "./indexManager.js";
import { IndexData } from "image-memory";

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

/**
 * Per session configuration to control various features of the dispatcher.
 */
export type DispatcherConfig = {
    // the agent that handles NLP requests
    request: string;

    // Translation configurations
    translation: {
        enabled: boolean;
        model: string;
        stream: boolean;
        promptConfig: {
            additionalInstructions: boolean;
        };
        switch: {
            fixed: string; // fixed first schema to use, ignore embedding if set
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
        entity: {
            resolve: boolean; // resolve entities in the request
            clarify: boolean; // clarify entity names when multiple entities match
            filter: boolean;
        };
    };

    // Execution configurations
    execution: {
        history: boolean;
        memory: {
            legacy: boolean; // use legacy memory behavior
        };
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

export type SessionConfig = AppAgentStateConfig & DispatcherConfig;
export type SessionSettings = DeepPartialUndefined<SessionConfig>;
export type SessionOptions = DeepPartialUndefinedAndNull<SessionConfig> | null;
export type SessionChanged = DeepPartialUndefined<SessionConfig> | undefined;

const defaultSessionConfig: SessionConfig = {
    schemas: {},
    actions: {},
    commands: {},

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
            fixed: "",
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
        entity: {
            resolve: true,
            filter: true,
            clarify: false, // TODO: enable when it is ready.
        },
    },
    execution: {
        history: true,
        memory: {
            legacy: true, // use the new memory behavior
        },
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

// explainer name as key, cache file path as value
type SessionCacheData = {
    [key: string]: string | undefined;
};

type SessionData = {
    settings?: SessionSettings | undefined;
    cacheData: SessionCacheData;
    tokens?: TokenCounterData;
    indexes?: IndexData[];
};

// Fill in missing fields when loading sessions from disk
function ensureSessionData(data: any): SessionData {
    if (data.config !== undefined) {
        // back compat
        data.settings = data.config;
    }

    if (data.settings !== undefined) {
        sanitizeConfig(defaultSessionConfig, data.settings, appAgentStateKeys);
    }
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
export class Session {
    private readonly defaultConfig = cloneConfig(defaultSessionConfig);
    private readonly settings: SessionSettings;
    private config: SessionConfig;
    private cacheData: SessionCacheData;

    public static async create(
        settings?: SessionSettings,
        instanceDir?: string,
    ) {
        const session = new Session(
            { settings, cacheData: {} },
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
            `Settings: ${JSON.stringify(sessionData.settings, undefined, 2)}`,
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
        this.settings = sessionData.settings ?? {};
        this.config = cloneConfig(defaultSessionConfig);
        mergeConfig(this.config, this.settings, appAgentStateKeys);
        this.cacheData = sessionData.cacheData;

        // rehydrate token stats
        if (sessionData.tokens) {
            TokenCounter.load(sessionData.tokens);
        }

        // rehydrate indexes
        if (sessionDirPath) {
            if (!sessionData.indexes) {
                sessionData.indexes = [];
            }

            IndexManager.load(sessionData.indexes, sessionDirPath);
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

    public getSettings(): Readonly<SessionSettings> {
        return this.settings;
    }

    public updateSettings(options: SessionOptions): SessionChanged {
        const changed = mergeConfig(this.settings, options, true);
        if (changed) {
            this.save();
        }
        return mergeConfig(
            this.config,
            options,
            appAgentStateKeys,
            this.defaultConfig,
        );
    }

    public getConfig(): Readonly<SessionConfig> {
        return this.config;
    }

    public updateConfig(settings: SessionSettings): SessionChanged {
        return mergeConfig(this.config, settings, appAgentStateKeys);
    }

    public updateDefaultConfig(settings: SessionSettings): SessionChanged {
        mergeConfig(this.defaultConfig, settings, appAgentStateKeys);
        // Get the latest configuration
        const newConfig = cloneConfig(this.defaultConfig);
        mergeConfig(newConfig, this.settings, appAgentStateKeys);
        return mergeConfig(this.config, newConfig, appAgentStateKeys);
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
            const cacheDir = getSessionConstructionDirPath(this.sessionDirPath);
            await fs.promises.mkdir(cacheDir, { recursive: true });
            const filePath = getUniqueFileName(
                cacheDir,
                `${this.explainerName}_${getYMDPrefix()}`,
                ".json",
            );
            this.setConstructionDataFilePath(filePath);
            return path.join(cacheDir, filePath);
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
                settings: isEmptySettings(this.settings)
                    ? undefined
                    : this.settings,
                cacheData: this.cacheData,
                tokens: TokenCounter.getInstance(),
                indexes: IndexManager.getInstance().indexes,
            };
            debugSession(
                `Saving session: ${getSessionName(this.sessionDirPath)}`,
            );
            debugSession(
                `Settings: ${JSON.stringify(data.settings, undefined, 2)}`,
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
        const fileExtension: string = getFileExtensionForMimeType(
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
                session.updateSettings({ cache: { enabled: false } });
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
