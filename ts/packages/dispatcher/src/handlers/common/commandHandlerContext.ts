// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess } from "child_process";
import { Limiter, createLimiter } from "common-utils";
import {
    ChildLogger,
    Logger,
    LoggerSink,
    MultiSinkLogger,
    createDebugLoggerSink,
    createMongoDBLoggerSink,
} from "telemetry";
import {
    AgentCache,
    GenericExplanationResult,
    RequestAction,
} from "agent-cache";
import { randomUUID } from "crypto";
import {
    Session,
    SessionOptions,
    setupAgentCache,
    setupBuiltInCache,
} from "../../session/session.js";
import {
    loadAgentJsonTranslator,
    ActionConfigProvider,
    TypeAgentTranslator,
    createTypeAgentTranslatorForSelectedActions,
} from "../../translation/agentTranslators.js";
import { getCacheFactory } from "../../utils/cacheFactory.js";
import { createServiceHost } from "../serviceHost/serviceHostCommandHandler.js";
import {
    ClientIO,
    RequestId,
    DispatcherName,
    nullClientIO,
} from "./interactiveIO.js";
import { ChatHistory, createChatHistory } from "./chatHistory.js";
import { ensureCacheDir, getUserId } from "../../utils/userData.js";
import { ActionContext, AppAgentEvent } from "@typeagent/agent-sdk";
import { Profiler } from "telemetry";
import { conversation as Conversation } from "knowledge-processor";
import {
    AppAgentManager,
    AppAgentStateOptions,
    SetStateResult,
} from "../../agent/appAgentManager.js";
import { loadTranslatorSchemaConfig } from "../../utils/loadSchemaConfig.js";
import { AppAgentProvider } from "../../agent/agentProvider.js";
import { RequestMetricsManager } from "../../utils/metrics.js";
import { getTranslatorPrefix } from "../../action/actionHandlers.js";
import { displayError } from "@typeagent/agent-sdk/helpers/display";

import {
    EmbeddingCache,
    readEmbeddingCache,
    writeEmbeddingCache,
} from "../../translation/actionSchemaSemanticMap.js";

import registerDebug from "debug";
import { getDefaultAppProviders } from "../../utils/defaultAppProviders.js";
import path from "node:path";

const debug = registerDebug("typeagent:dispatcher:init");

export interface CommandResult {
    error?: boolean;
    message?: string;
    html?: boolean;
}

export type EmptyFunction = () => void;
export type SetSettingFunction = (name: string, value: any) => void;
export interface ClientSettingsProvider {
    set: SetSettingFunction | null;
}

type ActionContextWithClose = {
    actionContext: ActionContext<unknown>;
    closeActionContext: () => void;
};

// Command Handler Context definition.
export type CommandHandlerContext = {
    agents: AppAgentManager;
    session: Session;

    conversationManager?: Conversation.ConversationManager | undefined;
    // Per activation configs
    developerMode?: boolean;
    explanationAsynchronousMode: boolean;
    dblogging: boolean;
    clientIO: ClientIO;

    // Runtime context
    commandLock: Limiter; // Make sure we process one command at a time.
    lastActionSchemaName: string;
    translatorCache: Map<string, TypeAgentTranslator>;
    agentCache: AgentCache;
    currentScriptDir: string;
    logger?: Logger | undefined;
    serviceHost: ChildProcess | undefined;
    localWhisper: ChildProcess | undefined;
    requestId?: RequestId;
    chatHistory: ChatHistory;

    batchMode: boolean;

    // For @correct
    lastRequestAction?: RequestAction;
    lastExplanation?: object;

    streamingActionContext?: ActionContextWithClose | undefined;

    metricsManager?: RequestMetricsManager | undefined;
    commandProfiler?: Profiler | undefined;
};

export function updateCorrectionContext(
    context: CommandHandlerContext,
    requestAction: RequestAction,
    explanationResult: GenericExplanationResult,
) {
    if (explanationResult.success) {
        context.lastExplanation = explanationResult.data;
        context.lastRequestAction = requestAction;
    }
}

export function getTranslatorForSchema(
    context: CommandHandlerContext,
    translatorName: string,
) {
    const translator = context.translatorCache.get(translatorName);
    if (translator !== undefined) {
        return translator;
    }
    const config = context.session.getConfig().translation;
    const newTranslator = loadAgentJsonTranslator(
        translatorName,
        context.agents,
        config.model,
        config.switch.inline ? getActiveTranslators(context) : undefined,
        config.multipleActions,
        config.schema.generation,
        !config.schema.optimize.enabled,
    );
    context.translatorCache.set(translatorName, newTranslator);
    return newTranslator;
}

export async function getTranslatorForSelectedActions(
    context: CommandHandlerContext,
    schemaName: string,
    request: string,
    numActions: number,
): Promise<TypeAgentTranslator | undefined> {
    const actionSchemaFile = context.agents.getActionSchemaFile(schemaName);
    if (
        actionSchemaFile === undefined ||
        actionSchemaFile.actionSchemas.size <= numActions
    ) {
        return undefined;
    }
    const nearestNeighbors = await context.agents.semanticSearchActionSchema(
        request,
        numActions,
        (name) => name === schemaName,
    );

    if (nearestNeighbors === undefined) {
        return undefined;
    }
    const config = context.session.getConfig().translation;
    return createTypeAgentTranslatorForSelectedActions(
        nearestNeighbors.map((e) => e.item.definition),
        schemaName,
        context.agents,
        config.model,
        config.switch.inline ? getActiveTranslators(context) : undefined,
        config.multipleActions,
    );
}

async function getAgentCache(
    session: Session,
    provider: ActionConfigProvider,
    logger: Logger | undefined,
) {
    const cacheFactory = getCacheFactory();
    const explainerName = session.explainerName;
    const agentCache = cacheFactory.create(
        explainerName,
        (translatorName: string) =>
            loadTranslatorSchemaConfig(translatorName, provider),
        session.cacheConfig,
        logger,
    );

    try {
        await setupAgentCache(session, agentCache);
    } catch (e) {
        // Silence the error, the cache will be disabled
    }

    return agentCache;
}

export type InitializeCommandHandlerContextOptions = SessionOptions & {
    appAgentProviders?: AppAgentProvider[];
    explanationAsynchronousMode?: boolean; // default to false
    persistSession?: boolean; // default to false,
    clientIO?: ClientIO | undefined; // undefined to disable any IO.
    enableServiceHost?: boolean; // default to false,
    metrics?: boolean; // default to false
};

async function getSession(persistSession: boolean = false) {
    let session: Session | undefined;
    if (persistSession) {
        try {
            session = await Session.restoreLastSession();
        } catch (e: any) {
            console.warn(`WARNING: ${e.message}. Creating new session.`);
        }
    }
    if (session === undefined) {
        // fill in the translator/action later.
        session = await Session.create(undefined, persistSession);
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

async function addAppAgentProvidres(
    context: CommandHandlerContext,
    appAgentProviders?: AppAgentProvider[],
    cacheDirPath?: string,
) {
    const embeddingCachePath = cacheDirPath
        ? path.join(cacheDirPath, "embeddingCache.json")
        : undefined;
    let embeddingCache: EmbeddingCache | undefined;

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

    const appProviders = getDefaultAppProviders(context);

    for (const provider of appProviders) {
        await context.agents.addProvider(provider, embeddingCache);
    }
    if (appAgentProviders) {
        for (const provider of appAgentProviders) {
            await context.agents.addProvider(provider, embeddingCache);
        }
    }
    if (embeddingCachePath) {
        try {
            const embeddings = context.agents.getActionEmbeddings();
            if (embeddings) {
                await writeEmbeddingCache(embeddingCachePath, embeddings);
                debug(
                    `Action Schema Embedding cache saved: ${embeddingCachePath}`,
                );
            }
        } catch {
            // Ignore error
        }
    }
}

export async function initializeCommandHandlerContext(
    hostName: string,
    options?: InitializeCommandHandlerContextOptions,
): Promise<CommandHandlerContext> {
    const metrics = options?.metrics ?? false;
    const explanationAsynchronousMode =
        options?.explanationAsynchronousMode ?? false;

    const session = await getSession(options?.persistSession);
    if (options) {
        session.setConfig(options);
    }
    const sessionDirPath = session.getSessionDirPath();
    debug(`Session directory: ${sessionDirPath}`);
    const conversationManager = sessionDirPath
        ? await Conversation.createConversationManager(
              {},
              "conversation",
              sessionDirPath,
              false,
          )
        : undefined;

    const clientIO = options?.clientIO ?? nullClientIO;
    const loggerSink = getLoggerSink(() => context.dblogging, clientIO);
    const logger = new ChildLogger(loggerSink, DispatcherName, {
        hostName,
        userId: getUserId(),
        sessionId: () => context.session.dir,
        activationId: randomUUID(),
    });

    var serviceHost = undefined;
    if (options?.enableServiceHost) {
        serviceHost = await createServiceHost();
    }

    const cacheDirPath = ensureCacheDir();
    const agents = new AppAgentManager(cacheDirPath);
    const context: CommandHandlerContext = {
        agents,
        session,
        conversationManager,
        explanationAsynchronousMode,
        dblogging: true,
        clientIO,

        // Runtime context
        commandLock: createLimiter(1), // Make sure we process one command at a time.
        agentCache: await getAgentCache(session, agents, logger),
        lastActionSchemaName: "",
        translatorCache: new Map<string, TypeAgentTranslator>(),
        currentScriptDir: process.cwd(),
        chatHistory: createChatHistory(),
        logger,
        serviceHost: serviceHost,
        localWhisper: undefined,
        metricsManager: metrics ? new RequestMetricsManager() : undefined,
        batchMode: false,
    };

    await addAppAgentProvidres(
        context,
        options?.appAgentProviders,
        cacheDirPath,
    );

    await setAppAgentStates(context, options);
    debug("Context initialized");
    return context;
}

async function setAppAgentStates(
    context: CommandHandlerContext,
    options?: AppAgentStateOptions,
) {
    const result = await context.agents.setState(
        context,
        context.session.getConfig(),
        options,
    );

    // Only rollback if user explicitly change state.
    // Ignore the returned rollback state for initialization and keep the session setting as is.

    processSetAppAgentStateResult(result, context, (message) =>
        context.clientIO.notify(
            AppAgentEvent.Error,
            undefined,
            message,
            DispatcherName,
        ),
    );
}

async function updateAppAgentStates(
    context: ActionContext<CommandHandlerContext>,
    changed: AppAgentStateOptions,
): Promise<AppAgentStateOptions> {
    const systemContext = context.sessionContext.agentContext;
    const result = await systemContext.agents.setState(
        systemContext,
        changed,
        undefined,
        false,
    );

    const rollback = processSetAppAgentStateResult(
        result,
        systemContext,
        (message) => displayError(message, context),
    );

    if (rollback) {
        systemContext.session.setConfig(rollback);
    }
    const resultState: AppAgentStateOptions = {};
    for (const [stateName, changed] of Object.entries(result.changed)) {
        if (changed.length !== 0) {
            resultState[stateName as keyof AppAgentStateOptions] =
                Object.fromEntries(changed);
        }
    }
    return resultState;
}

function processSetAppAgentStateResult(
    result: SetStateResult,
    systemContext: CommandHandlerContext,
    cbError: (message: string) => void,
): AppAgentStateOptions | undefined {
    let hasFailed = false;
    const rollback = { actions: {}, commands: {} };
    for (const [stateName, failed] of Object.entries(result.failed)) {
        for (const [translatorName, enable, e] of failed) {
            hasFailed = true;
            const prefix =
                stateName === "commands"
                    ? systemContext.agents.getEmojis()[translatorName]
                    : getTranslatorPrefix(translatorName, systemContext);
            cbError(
                `${prefix}: Failed to ${enable ? "enable" : "disable"} ${stateName}: ${e.message}`,
            );
            (rollback as any)[stateName][translatorName] = !enable;
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
}

export async function setSessionOnCommandHandlerContext(
    context: CommandHandlerContext,
    session: Session,
) {
    context.session = session;
    await context.agents.close();
    context.agentCache = await getAgentCache(
        context.session,
        context.agents,
        context.logger,
    );
    await setAppAgentStates(context);
}

export async function reloadSessionOnCommandHandlerContext(
    context: CommandHandlerContext,
    persist: boolean,
) {
    const session = await getSession(persist);
    await setSessionOnCommandHandlerContext(context, session);
}

export async function changeContextConfig(
    options: SessionOptions,
    context: ActionContext<CommandHandlerContext>,
) {
    const systemContext = context.sessionContext.agentContext;
    const session = systemContext.session;
    const changed = session.setConfig(options);

    const translatorChanged = changed.hasOwnProperty("schemas");
    const actionsChanged = changed.hasOwnProperty("actions");
    const commandsChanged = changed.hasOwnProperty("commands");

    if (
        translatorChanged ||
        changed.translation?.model !== undefined ||
        changed.translation?.switch?.inline !== undefined ||
        changed.translation?.multipleActions !== undefined ||
        changed.translation?.schema?.generation !== undefined ||
        changed.translation?.schema?.optimize?.enabled !== undefined
    ) {
        // Schema changed, clear the cache to regenerate them.
        systemContext.translatorCache.clear();
    }

    if (translatorChanged || actionsChanged || commandsChanged) {
        Object.assign(changed, await updateAppAgentStates(context, changed));
    }

    if (changed.explainer?.name !== undefined) {
        try {
            systemContext.agentCache = await getAgentCache(
                session,
                systemContext.agents,
                systemContext.logger,
            );
        } catch (e: any) {
            displayError(`Failed to change explainer: ${e.message}`, context);
            delete changed.explainer?.name;
            // Restore old explainer name
            session.setConfig({
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
        await setupAgentCache(session, agentCache);
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
            await setupBuiltInCache(session, agentCache, builtInCache);
        }
    }

    return changed;
}

function getActiveTranslators(context: CommandHandlerContext) {
    return Object.fromEntries(
        context.agents.getActiveSchemas().map((name) => [name, true]),
    );
}
