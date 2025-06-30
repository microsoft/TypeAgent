// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess } from "child_process";
import { DeepPartialUndefined, Limiter, createLimiter } from "common-utils";
import {
    ChildLogger,
    Logger,
    LoggerSink,
    MultiSinkLogger,
    createDebugLoggerSink,
    createMongoDBLoggerSink,
} from "telemetry";
import { AgentCache } from "agent-cache";
import { randomUUID } from "crypto";
import {
    DispatcherConfig,
    getSessionName,
    Session,
    SessionOptions,
    setupAgentCache,
    setupBuiltInCache,
} from "./session.js";
import { TypeAgentTranslator } from "../translation/agentTranslators.js";
import { ActionConfigProvider } from "../translation/actionConfigProvider.js";
import { getCacheFactory } from "../utils/cacheFactory.js";
import { createServiceHost } from "./system/handlers/serviceHost/serviceHostCommandHandler.js";
import { ClientIO, nullClientIO, RequestId } from "./interactiveIO.js";
import { ChatHistory, createChatHistory } from "./chatHistory.js";

import {
    ensureCacheDir,
    ensureDirectory,
    lockInstanceDir,
} from "../utils/fsUtils.js";
import {
    ActionContext,
    AppAgentEvent,
    ActivityContext,
} from "@typeagent/agent-sdk";
import { Profiler } from "telemetry";
import { conversation as Conversation } from "knowledge-processor";
import {
    AppAgentManager,
    AppAgentStateInitSettings,
    AppAgentStateSettings,
    getAppAgentStateSettings,
    SetStateResult,
} from "./appAgentManager.js";
import {
    AppAgentInstaller,
    AppAgentProvider,
    ConstructionProvider,
} from "../agentProvider/agentProvider.js";
import { RequestMetricsManager } from "../utils/metrics.js";
import { getSchemaNamePrefix } from "../execute/actionHandlers.js";
import { displayError } from "@typeagent/agent-sdk/helpers/display";

import {
    EmbeddingCache,
    readEmbeddingCache,
    writeEmbeddingCache,
} from "../translation/actionSchemaSemanticMap.js";

import registerDebug from "debug";
import path from "node:path";
import { createSchemaInfoProvider } from "../translation/actionSchemaFileCache.js";
import { createBuiltinAppAgentProvider } from "./inlineAgentProvider.js";
import { CommandResult } from "../dispatcher.js";
import { DispatcherName } from "./dispatcher/dispatcherUtils.js";
import lockfile from "proper-lockfile";
import { IndexManager } from "./indexManager.js";
import { ActionContextWithClose } from "../execute/actionContext.js";

const debug = registerDebug("typeagent:dispatcher:init");
const debugError = registerDebug("typeagent:dispatcher:init:error");

export type EmptyFunction = () => void;
export type SetSettingFunction = (name: string, value: any) => void;

export function getCommandResult(
    context: CommandHandlerContext,
): CommandResult | undefined {
    if (context.collectCommandResult) {
        return ensureCommandResult(context);
    }
    return undefined;
}

export function ensureCommandResult(
    context: CommandHandlerContext,
): CommandResult {
    if (context.commandResult === undefined) {
        context.commandResult = {};
    }
    return context.commandResult;
}

// Command Handler Context definition.
export type CommandHandlerContext = {
    readonly agents: AppAgentManager;
    readonly agentInstaller: AppAgentInstaller | undefined;
    session: Session;

    readonly persistDir: string | undefined;
    readonly cacheDir: string | undefined;
    readonly embeddingCacheDir: string | undefined;

    readonly indexManager: IndexManager;

    activityContext?: ActivityContext | undefined;
    conversationManager?: Conversation.ConversationManager | undefined;
    // Per activation configs
    developerMode?: boolean;
    explanationAsynchronousMode: boolean;
    dblogging: boolean;
    clientIO: ClientIO;
    collectCommandResult: boolean;

    // Runtime context
    commandLock: Limiter; // Make sure we process one command at a time.
    lastActionSchemaName: string;
    pendingToggleTransientAgents: [string, boolean][];
    translatorCache: Map<string, TypeAgentTranslator>;
    agentCache: AgentCache;
    currentScriptDir: string;
    logger?: Logger | undefined;
    serviceHost: ChildProcess | undefined;
    requestId?: RequestId;
    commandResult?: CommandResult | undefined;
    chatHistory: ChatHistory;
    constructionProvider?: ConstructionProvider | undefined;

    batchMode: boolean;
    streamingActionContext?: ActionContextWithClose | undefined;
    metricsManager?: RequestMetricsManager | undefined;
    commandProfiler?: Profiler | undefined;

    instanceDirLock: (() => Promise<void>) | undefined;
};

async function getAgentCache(
    session: Session,
    provider: ActionConfigProvider,
    constructionProvider?: ConstructionProvider,
    logger?: Logger,
) {
    const cacheFactory = getCacheFactory();
    const explainerName = session.explainerName;
    const actionSchemaProvider = createSchemaInfoProvider(provider);

    const agentCache = cacheFactory.create(
        explainerName,
        actionSchemaProvider,
        session.cacheConfig,
        logger,
    );

    try {
        await setupAgentCache(session, agentCache, constructionProvider);
    } catch (e) {
        // Silence the error, the cache will be disabled
    }

    return agentCache;
}

/**
 * Settings to initialize the dispatcher.
 *
 * Core options:
 * - appAgentProviders: list of app agent providers to use. If not specified, only the system agents are available.
 * * - clientIO: The client IO to use for interactivity. If not specified, no interactivity is available.
 * - persistDir: The directory to save states, including cache and session (if enabled)
 * - persistSession: whether to save and restore session state across runs.
 *
 * Agent port assignments - for agents that host their own http server:
 * - portBase: The base port to use for the agents. Default is 9001.   Agents will be assigned ports starting from this value.
 * - allowSharedLocalView: The list of agent names that can get the ports of all other agent's port. Default is undefined.
 *
 * Logging options:
 * - metrics: whether to enable collection of timing metrics. Default is false.
 * - collectCommandResult: whether to collect command result in the return for `processCommand`. Default is false.
 * - dblogging: whether to enable database logging. If not specified, no logging is done.
 * - clientId: An optional client ID to use for logging identification.
 */
export type DispatcherOptions = DeepPartialUndefined<DispatcherConfig> & {
    // Core options
    appAgentProviders?: AppAgentProvider[];
    persistDir?: string | undefined; // the directory to save state.
    persistSession?: boolean; // default to false,
    clientIO?: ClientIO | undefined; // required for interactivity, undefined to disable any IO.

    // Initial state settings
    agents?: AppAgentStateInitSettings;

    // Agent port assignments
    allowSharedLocalView?: string[]; // agents that can access any shared local views, default to undefined
    portBase?: number; // default to 9001

    // Agent specific initialization options.
    agentInitOptions?: Record<string, unknown>; // agent specific initialization options.

    // Logging options
    metrics?: boolean; // default to false
    collectCommandResult?: boolean; // default to false
    dblogging?: boolean; // default to false
    clientId?: string; // optional additional for logging identification

    // Additional integration options
    agentInstaller?: AppAgentInstaller;
    enableServiceHost?: boolean; // default to false,
    constructionProvider?: ConstructionProvider;
    explanationAsynchronousMode?: boolean; // default to true

    // Use for tests so that embedding can be cached without 'persistDir'
    embeddingCacheDir?: string | undefined; // default to 'cache' under 'persistDir' if specified
};

async function getSession(instanceDir?: string) {
    let session: Session | undefined;
    if (instanceDir !== undefined) {
        try {
            session = await Session.restoreLastSession(instanceDir);
        } catch (e: any) {
            debugError(`WARNING: ${e.message}. Creating new session.`);
        }
    }
    if (session === undefined) {
        // fill in the translator/action later.
        session = await Session.create(undefined, instanceDir);
    }
    return session;
}

function getLoggerSink(isDbEnabled: () => boolean, clientIO: ClientIO) {
    const debugLoggerSink = createDebugLoggerSink();
    let dbLoggerSink: LoggerSink | undefined;

    try {
        dbLoggerSink = createMongoDBLoggerSink(
            "telemetrydb",
            "dispatcherlogs",
            isDbEnabled,
            (e: string) => {
                clientIO.notify(
                    AppAgentEvent.Warning,
                    undefined,
                    e,
                    DispatcherName,
                );
            },
        );
    } catch (e) {
        clientIO.notify(
            AppAgentEvent.Warning,
            undefined,
            `DB logging disabled. ${e}`,
            DispatcherName,
        );
    }

    return new MultiSinkLogger(
        dbLoggerSink === undefined
            ? [debugLoggerSink]
            : [debugLoggerSink, dbLoggerSink],
    );
}

async function lockEmbeddingCacheDir(context: CommandHandlerContext) {
    return context.embeddingCacheDir
        ? await lockfile.lock(context.embeddingCacheDir, {
              retries: {
                  minTimeout: 50,
                  maxTimeout: 1000,
                  randomize: true,
                  forever: true, // embedding cache dir is used for test, so only to retry forever.
                  maxRetryTime: 1000 * 60 * 5, // but place a time limit of 5 minutes
              },
          })
        : undefined;
}

async function addAppAgentProviders(
    context: CommandHandlerContext,
    appAgentProviders?: AppAgentProvider[],
) {
    const embeddingCachePath = getEmbeddingCachePath(context);
    let embeddingCache: EmbeddingCache | undefined;

    const unlock = await lockEmbeddingCacheDir(context);
    try {
        if (embeddingCachePath) {
            try {
                embeddingCache = await readEmbeddingCache(embeddingCachePath);
                debug(
                    `Action Schema Embedding cache loaded: ${embeddingCachePath}`,
                );
            } catch {
                // Ignore error
            }
        }

        const inlineAppProvider = createBuiltinAppAgentProvider(context);
        await context.agents.addProvider(inlineAppProvider, embeddingCache);

        if (appAgentProviders) {
            for (const provider of appAgentProviders) {
                await context.agents.addProvider(provider, embeddingCache);
            }
        }
        if (embeddingCachePath) {
            return saveActionEmbeddings(context, embeddingCachePath);
        }
    } finally {
        if (unlock) {
            await unlock();
        }
    }
}

function getEmbeddingCachePath(context: CommandHandlerContext) {
    const cacheDir = context.embeddingCacheDir ?? context.cacheDir;
    return cacheDir ? path.join(cacheDir, "embeddingCache.json") : undefined;
}

async function saveActionEmbeddings(
    context: CommandHandlerContext,
    embeddingCachePath: string,
) {
    try {
        const embeddings = context.agents.getActionEmbeddings();
        if (embeddings) {
            await writeEmbeddingCache(embeddingCachePath, embeddings);
            debug(`Action Schema Embedding cache saved: ${embeddingCachePath}`);
        }
    } catch {
        // Ignore error
    }
}

export async function installAppProvider(
    context: CommandHandlerContext,
    provider: AppAgentProvider,
) {
    // Don't use embedding cache for a new agent.
    await context.agents.addProvider(provider);

    await setAppAgentStates(context);

    const embeddingCachePath = getEmbeddingCachePath(context);
    if (embeddingCachePath !== undefined) {
        const unlock = await lockEmbeddingCacheDir(context);
        try {
            await saveActionEmbeddings(context, embeddingCachePath);
        } finally {
            if (unlock) {
                await unlock();
            }
        }
    }
}

export async function initializeCommandHandlerContext(
    hostName: string,
    options?: DispatcherOptions,
): Promise<CommandHandlerContext> {
    const metrics = options?.metrics ?? false;
    const explanationAsynchronousMode =
        options?.explanationAsynchronousMode ?? true;

    const persistSession = options?.persistSession ?? false;
    const persistDir = options?.persistDir;

    if (persistDir === undefined && persistSession) {
        throw new Error(
            "Persist session requires persistDir to be set in options.",
        );
    }

    const instanceDirLock = persistDir
        ? await lockInstanceDir(persistDir)
        : undefined;

    try {
        const session = await getSession(
            persistSession ? persistDir : undefined,
        );

        // initialization options set the default, but persisted configuration will still overrides it.
        if (options) {
            session.updateDefaultConfig(options);
        }
        const sessionDirPath = session.getSessionDirPath();
        debug(`Session directory: ${sessionDirPath}`);
        const clientIO = options?.clientIO ?? nullClientIO;
        const loggerSink = getLoggerSink(() => context.dblogging, clientIO);
        const logger = new ChildLogger(loggerSink, DispatcherName, {
            hostName,
            clientId: options?.clientId,
            sessionId: () =>
                context.session.sessionDirPath
                    ? getSessionName(context.session.sessionDirPath)
                    : undefined,
            activationId: randomUUID(),
        });

        var serviceHost = undefined;
        if (options?.enableServiceHost) {
            serviceHost = await createServiceHost();
        }

        const cacheDir = persistDir ? ensureCacheDir(persistDir) : undefined;
        const embeddingCacheDir = options?.embeddingCacheDir;
        if (embeddingCacheDir) {
            ensureDirectory(embeddingCacheDir);
        }
        const portBase = options?.portBase ?? 9001;
        const agents = new AppAgentManager(
            cacheDir,
            portBase,
            options?.allowSharedLocalView,
            options?.agentInitOptions,
        );
        const constructionProvider = options?.constructionProvider;
        const context: CommandHandlerContext = {
            agents,
            agentInstaller: options?.agentInstaller,
            session,
            persistDir,
            cacheDir,
            embeddingCacheDir,
            conversationManager:
                await createConversationManager(sessionDirPath),
            explanationAsynchronousMode,
            dblogging: options?.dblogging ?? false,
            clientIO,

            // Runtime context
            commandLock: createLimiter(1), // Make sure we process one command at a time.
            pendingToggleTransientAgents: [],
            agentCache: await getAgentCache(
                session,
                agents,
                constructionProvider,
                logger,
            ),
            lastActionSchemaName: DispatcherName,
            translatorCache: new Map<string, TypeAgentTranslator>(),
            currentScriptDir: process.cwd(),
            chatHistory: createChatHistory(
                session.getConfig().execution.history,
            ),
            logger,
            serviceHost,
            metricsManager: metrics ? new RequestMetricsManager() : undefined,
            batchMode: false,
            instanceDirLock,
            constructionProvider,
            collectCommandResult: options?.collectCommandResult ?? false,
            indexManager: IndexManager.getInstance(),
        };

        await addAppAgentProviders(context, options?.appAgentProviders);

        const appAgentStateSettings = getAppAgentStateSettings(
            options?.agents,
            agents,
        );
        if (appAgentStateSettings !== undefined) {
            // initialization options set the default, but persisted configuration will still overrides it.
            session.updateDefaultConfig(appAgentStateSettings);
        }
        await setAppAgentStates(context);
        debug("Context initialized");
        return context;
    } catch (e) {
        if (instanceDirLock) {
            instanceDirLock();
        }
        throw e;
    }
}

async function setAppAgentStates(context: CommandHandlerContext) {
    const result = await context.agents.setState(
        context,
        context.session.getConfig(),
    );

    // Only rollback if user explicitly change state.
    // Ignore the returned rollback state for initialization and keep the session setting as is.

    const rollback = processSetAppAgentStateResult(result, context, (message) =>
        context.clientIO.notify(
            AppAgentEvent.Error,
            undefined,
            message,
            DispatcherName,
        ),
    );

    if (rollback) {
        context.session.updateConfig(rollback);
    }
}

async function updateAppAgentStates(
    context: ActionContext<CommandHandlerContext>,
): Promise<AppAgentStateSettings> {
    const systemContext = context.sessionContext.agentContext;
    const result = await systemContext.agents.setState(
        systemContext,
        systemContext.session.getConfig(),
    );

    const rollback = processSetAppAgentStateResult(
        result,
        systemContext,
        (message) => displayError(message, context),
    );

    if (rollback) {
        systemContext.session.updateConfig(rollback);
    }
    const resultState: AppAgentStateSettings = {};
    for (const [stateName, changed] of Object.entries(result.changed)) {
        if (changed.length !== 0) {
            resultState[stateName as keyof AppAgentStateSettings] =
                Object.fromEntries(changed);
        }
    }
    return resultState;
}

function processSetAppAgentStateResult(
    result: SetStateResult,
    systemContext: CommandHandlerContext,
    cbError: (message: string) => void,
): AppAgentStateSettings | undefined {
    let hasFailed = false;
    const rollback = { schemas: {}, actions: {}, commands: {} };
    for (const [stateName, failed] of Object.entries(result.failed)) {
        for (const [schemaName, enable, e] of failed) {
            hasFailed = true;
            const prefix =
                stateName === "commands"
                    ? systemContext.agents.getEmojis()[schemaName]
                    : getSchemaNamePrefix(schemaName, systemContext);
            debugError(e);
            cbError(
                `${prefix}: Failed to ${enable ? "enable" : "disable"} ${stateName}: ${e.message}`,
            );
            (rollback as any)[stateName][schemaName] = !enable;
        }
    }

    return hasFailed ? rollback : undefined;
}

export async function closeCommandHandlerContext(
    context: CommandHandlerContext,
) {
    context.serviceHost?.kill();
    // Save the session because the token count is in it.
    context.session.save();
    await context.agents.close();
    if (context.instanceDirLock) {
        await context.instanceDirLock();
    }
}

async function createConversationManager(
    sessionDirPath: string | undefined,
): Promise<Conversation.ConversationManager | undefined> {
    return sessionDirPath
        ? await Conversation.createConversationManager(
              {},
              "conversation",
              sessionDirPath,
              false,
          )
        : undefined;
}
export async function setSessionOnCommandHandlerContext(
    context: CommandHandlerContext,
    session: Session,
) {
    context.session = session;
    await context.agents.close();

    context.conversationManager = await createConversationManager(
        session.getSessionDirPath(),
    );
    context.agentCache = await getAgentCache(
        context.session,
        context.agents,
        context.constructionProvider,
        context.logger,
    );
    await setAppAgentStates(context);
    context.translatorCache.clear();
}

export async function reloadSessionOnCommandHandlerContext(
    context: CommandHandlerContext,
    persist: boolean,
) {
    const session = await getSession(persist ? context.persistDir : undefined);
    await setSessionOnCommandHandlerContext(context, session);
}

export async function changeContextConfig(
    options: SessionOptions,
    context: ActionContext<CommandHandlerContext>,
) {
    const systemContext = context.sessionContext.agentContext;
    const session = systemContext.session;
    const changed = session.updateSettings(options);
    if (changed === undefined) {
        return undefined;
    }

    const schemasChanged = changed.hasOwnProperty("schemas");
    const actionsChanged = changed.hasOwnProperty("actions");
    const commandsChanged = changed.hasOwnProperty("commands");

    if (
        schemasChanged ||
        changed.translation?.model !== undefined ||
        changed.translation?.switch?.inline !== undefined ||
        changed.translation?.multiple !== undefined ||
        changed.translation?.schema?.generation !== undefined ||
        changed.translation?.schema?.optimize?.enabled !== undefined
    ) {
        // Schema changed, clear the cache to regenerate them.
        systemContext.translatorCache.clear();
    }

    if (schemasChanged || actionsChanged || commandsChanged) {
        Object.assign(changed, await updateAppAgentStates(context));
    }

    if (changed.explainer?.name !== undefined) {
        try {
            systemContext.agentCache = await getAgentCache(
                session,
                systemContext.agents,
                systemContext.constructionProvider,
                systemContext.logger,
            );
        } catch (e: any) {
            displayError(`Failed to change explainer: ${e.message}`, context);
            delete changed.explainer?.name;
            // Restore old explainer name
            session.updateSettings({
                explainer: {
                    name: systemContext.agentCache.explainerName,
                },
            });
        }

        // New cache is recreated, not need to manually change settings.
        return changed;
    }

    const agentCache = systemContext.agentCache;
    // Propagate the options to the cache
    if (changed.cache !== undefined) {
        agentCache.constructionStore.setConfig(changed.cache);
    }

    // cache and auto save are handled separately
    if (changed.cache?.enabled !== undefined) {
        // the cache state is changed.
        // Auto save, model and builtInCache is configured in setupAgentCache as well.
        await setupAgentCache(
            session,
            agentCache,
            systemContext.constructionProvider,
        );
    } else {
        const autoSave = changed.cache?.autoSave;
        if (autoSave !== undefined) {
            // Make sure the cache has a file for a persisted session
            if (autoSave) {
                if (session.getConfig().cache) {
                    const cacheDataFilePath =
                        await session.ensureCacheDataFilePath();
                    await agentCache.constructionStore.save(cacheDataFilePath);
                }
            }
            await agentCache.constructionStore.setAutoSave(autoSave);
        }
        if (changed.explainer?.model !== undefined) {
            agentCache.model = changed.explainer?.model;
        }
        const builtInCache = changed.cache?.builtInCache;
        if (builtInCache !== undefined) {
            await setupBuiltInCache(
                session,
                agentCache,
                builtInCache,
                systemContext.constructionProvider,
            );
        }
    }

    return changed;
}
