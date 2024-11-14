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
import readline from "readline/promises";
import {
    Session,
    SessionOptions,
    setupAgentCache,
    setupBuiltInCache,
} from "../../session/session.js";
import {
    getDefaultBuiltinTranslatorName,
    loadAgentJsonTranslator,
    TranslatorConfigProvider,
    TypeAgentTranslator,
} from "../../translation/agentTranslators.js";
import { getCacheFactory } from "../../utils/cacheFactory.js";
import { createServiceHost } from "../serviceHost/serviceHostCommandHandler.js";
import {
    ClientIO,
    RequestIO,
    getConsoleRequestIO,
    getRequestIO,
    RequestId,
    getNullRequestIO,
    DispatcherName,
} from "./interactiveIO.js";
import { ChatHistory, createChatHistory } from "./chatHistory.js";
import { getUserId } from "../../utils/userData.js";
import { ActionContext, AppAgentEvent } from "@typeagent/agent-sdk";
import { Profiler } from "telemetry";
import { conversation as Conversation } from "knowledge-processor";
import {
    AppAgentManager,
    AppAgentStateOptions,
    SetStateResult,
} from "./appAgentManager.js";
import {
    getBuiltinAppAgentProvider,
    getExternalAppAgentProvider,
} from "../../agent/agentConfig.js";
import { loadTranslatorSchemaConfig } from "../../utils/loadSchemaConfig.js";
import { AppAgentProvider } from "../../agent/agentProvider.js";
import { RequestMetricsManager } from "../../utils/metrics.js";
import { getTranslatorPrefix } from "../../action/actionHandlers.js";
import { displayError } from "@typeagent/agent-sdk/helpers/display";

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
    clientIO: ClientIO | undefined | null;
    requestIO: RequestIO;

    // Runtime context
    commandLock: Limiter; // Make sure we process one command at a time.
    lastActionTranslatorName: string;
    translatorCache: Map<string, TypeAgentTranslator>;
    agentCache: AgentCache;
    currentScriptDir: string;
    logger?: Logger | undefined;
    serviceHost: ChildProcess | undefined;
    localWhisper: ChildProcess | undefined;
    requestId?: RequestId;
    chatHistory: ChatHistory;

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

export function getTranslator(
    context: CommandHandlerContext,
    translatorName: string,
) {
    const translator = context.translatorCache.get(translatorName);
    if (translator !== undefined) {
        return translator;
    }
    const config = context.session.getConfig();
    const newTranslator = loadAgentJsonTranslator(
        translatorName,
        context.agents,
        config.models.translator,
        config.switch.inline ? getActiveTranslators(context) : undefined,
        config.multipleActions,
    );
    context.translatorCache.set(translatorName, newTranslator);
    return newTranslator;
}

async function getAgentCache(
    session: Session,
    provider: TranslatorConfigProvider,
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
    stdio?: readline.Interface;
    clientIO?: ClientIO | undefined | null; // default to console IO, null to disable
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

function getLoggerSink(isDbEnabled: () => boolean, requestIO: RequestIO) {
    const debugLoggerSink = createDebugLoggerSink();
    let dbLoggerSink: LoggerSink | undefined;

    try {
        dbLoggerSink = createMongoDBLoggerSink(
            "telemetrydb",
            "dispatcherlogs",
            isDbEnabled,
        );
    } catch (e) {
        requestIO.notify(
            AppAgentEvent.Warning,
            undefined,
            `DB logging disabled. ${e}`,
        );
    }

    return new MultiSinkLogger(
        dbLoggerSink === undefined
            ? [debugLoggerSink]
            : [debugLoggerSink, dbLoggerSink],
    );
}

export async function initializeCommandHandlerContext(
    hostName: string,
    options?: InitializeCommandHandlerContextOptions,
): Promise<CommandHandlerContext> {
    const metrics = options?.metrics ?? false;
    const explanationAsynchronousMode =
        options?.explanationAsynchronousMode ?? false;
    const stdio = options?.stdio;

    const session = await getSession(options?.persistSession);
    if (options) {
        session.setConfig(options);
    }
    const sessionDirPath = session.getSessionDirPath();
    const conversationManager = sessionDirPath
        ? await Conversation.createConversationManager(
              {},
              "conversation",
              sessionDirPath,
              false,
          )
        : undefined;

    const clientIO = options?.clientIO;
    const requestIO = clientIO
        ? getRequestIO(undefined, clientIO)
        : clientIO === undefined
          ? getConsoleRequestIO(stdio)
          : getNullRequestIO();
    const loggerSink = getLoggerSink(() => context.dblogging, requestIO);
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

    const agents = new AppAgentManager();
    const context: CommandHandlerContext = {
        agents,
        session,
        conversationManager,
        explanationAsynchronousMode,
        dblogging: true,
        clientIO,
        requestIO,

        // Runtime context
        commandLock: createLimiter(1), // Make sure we process one command at a time.
        agentCache: await getAgentCache(session, agents, logger),
        lastActionTranslatorName: getDefaultBuiltinTranslatorName(), // REVIEW: just default to the first one on initialize?
        translatorCache: new Map<string, TypeAgentTranslator>(),
        currentScriptDir: process.cwd(),
        chatHistory: createChatHistory(),
        logger,
        serviceHost: serviceHost,
        localWhisper: undefined,
        metricsManager: metrics ? new RequestMetricsManager() : undefined,
    };
    context.requestIO.context = context;

    await agents.addProvider(getBuiltinAppAgentProvider(context), context);
    const appAgentProviders = options?.appAgentProviders;
    if (appAgentProviders !== undefined) {
        for (const provider of appAgentProviders) {
            await agents.addProvider(provider, context);
        }
    }

    await agents.addProvider(getExternalAppAgentProvider(context), context);

    await setAppAgentStates(context, options);
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
        context.requestIO.notify(AppAgentEvent.Error, undefined, message),
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
            const prefix = getTranslatorPrefix(translatorName, systemContext);
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

    const translatorChanged = changed.hasOwnProperty("translators");
    const actionsChanged = changed.hasOwnProperty("actions");
    const commandsChanged = changed.hasOwnProperty("commands");

    if (
        translatorChanged ||
        changed.models?.translator !== undefined ||
        changed.switch?.inline ||
        changed.multipleActions
    ) {
        // The dynamic schema for change assistant is changed.
        // Clear the cache to regenerate them.
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
        if (changed.models?.explainer !== undefined) {
            agentCache.model = changed.models.explainer;
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
        context.agents.getActiveTranslators().map((name) => [name, true]),
    );
}
