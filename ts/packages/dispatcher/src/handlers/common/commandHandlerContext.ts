// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess } from "child_process";
import {
    ChildLogger,
    DeepPartialUndefined,
    Limiter,
    Logger,
    LoggerSink,
    MultiSinkLogger,
    TypeChatJsonTranslatorWithStreaming,
    createDebugLoggerSink,
    createLimiter,
    createMongoDBLoggerSink,
    enableJsonTranslatorStreaming,
} from "common-utils";
import {
    AgentCache,
    GenericExplanationResult,
    RequestAction,
} from "agent-cache";
import { randomUUID } from "crypto";
import readline from "readline/promises";
import type { TypeChatJsonTranslator } from "typechat";
import {
    Session,
    SessionOptions,
    configAgentCache,
    getDefaultSessionConfig,
} from "../../session/session.js";
import {
    getDefaultBuiltinTranslatorName,
    loadAgentJsonTranslator,
    TranslatorConfigProvider,
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
import { conversation as Conversation } from "knowledge-processor";
import { AppAgentManager, AppAgentState } from "./appAgentManager.js";
import { getBuiltinAppAgentProvider } from "../../agent/agentConfig.js";
import { loadTranslatorSchemaConfig } from "../../utils/loadSchemaConfig.js";
import { isMultiModalContentSupported } from "../../../../commonUtils/dist/modelResource.js";
import { AppAgentProvider } from "../../agent/agentProvider.js";

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

// Command Handler Context definition.
export type CommandHandlerContext = {
    agents: AppAgentManager;
    session: Session;

    conversationManager?: Conversation.ConversationManager;
    // Per activation configs
    developerMode?: boolean;
    explanationAsynchronousMode: boolean;
    dblogging: boolean;
    clientIO: ClientIO | undefined | null;
    requestIO: RequestIO;

    // Runtime context
    commandLock: Limiter; // Make sure we process one command at a time.
    lastActionTranslatorName: string;
    translatorCache: Map<string, TypeChatJsonTranslatorWithStreaming<object>>;
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

    transientAgents: Record<string, boolean | undefined>;

    streamingActionContext?: ActionContext<unknown> | undefined;
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
    const streamingTranslator = enableJsonTranslatorStreaming(newTranslator);
    context.translatorCache.set(translatorName, streamingTranslator);
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
        await configAgentCache(session, agentCache);
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
        session = await Session.create(
            getDefaultSessionConfig(),
            persistSession,
        );
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
    const explanationAsynchronousMode =
        options?.explanationAsynchronousMode ?? false;
    const stdio = options?.stdio;

    const session = await getSession(options?.persistSession);
    if (options) {
        session.setConfig(options);
    }
    const path = session.getSessionDirPath();
    const conversationManager = await Conversation.createConversationManager(
        "conversation",
        path ? path : "/data/testChat",
        false,
    );

    const clientIO = options?.clientIO;
    const requestIO = clientIO
        ? getRequestIO(undefined, clientIO, undefined)
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
        translatorCache: new Map<string, TypeChatJsonTranslator<object>>(),
        currentScriptDir: process.cwd(),
        chatHistory: createChatHistory(),
        logger,
        serviceHost: serviceHost,
        localWhisper: undefined,
        transientAgents: {},
    };
    context.requestIO.context = context;

    await agents.addProvider(getBuiltinAppAgentProvider(context), context);
    const appAgentProviders = options?.appAgentProviders;
    if (appAgentProviders !== undefined) {
        for (const provider of appAgentProviders) {
            await agents.addProvider(provider, context);
        }
    }

    for (const [name, config] of agents.getTranslatorConfigs()) {
        if (config.transient) {
            context.transientAgents[name] = false;
        }
    }
    await setAppAgentStates(context, options);
    return context;
}

async function setAppAgentStates(
    context: CommandHandlerContext,
    options?: DeepPartialUndefined<AppAgentState>,
) {
    const result = await context.agents.setState(
        context,
        context.session.getConfig(),
        options,
    );

    processSetAppAgentStateResult(result, (message, source) =>
        context.requestIO.notify(
            AppAgentEvent.Error,
            undefined,
            message,
            source,
        ),
    );
}

async function updateAppAgentStates(
    context: CommandHandlerContext,
    changed: DeepPartialUndefined<AppAgentState>,
): Promise<AppAgentState> {
    const result = await context.agents.setState(
        context,
        changed,
        undefined,
        false,
    );

    const rollback = processSetAppAgentStateResult(result, (message, source) =>
        context.requestIO.error(message, source),
    );

    if (rollback) {
        context.session.setConfig(rollback);
    }
    const resultState: AppAgentState = {};
    if (result.changed.translators.length !== 0) {
        resultState.translators = Object.fromEntries(
            result.changed.translators,
        );
    }
    if (result.changed.actions.length !== 0) {
        resultState.actions = Object.fromEntries(result.changed.actions);
    }
    return resultState;
}

function processSetAppAgentStateResult(
    result: any,
    cbError: (message: string, source: string) => void,
) {
    if (result.failed.actions.length !== 0) {
        const rollback: AppAgentState = { actions: {} };
        for (const [translatorName, enable, e] of result.failed.actions) {
            cbError(
                `Failed to ${enable ? "enable" : "disable"} ${translatorName} action: ${e.message}`,
                translatorName,
            );
            rollback.actions![translatorName] = !enable;
        }
        return rollback;
    }

    return undefined;
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
    context: CommandHandlerContext,
) {
    const changed = context.session.setConfig(options);

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
        context.translatorCache.clear();

        // update client settings for multi-modal support
        if (context.clientSettings) {
            context.clientSettings.set!("multiModalContent", isMultiModalContentSupported(changed.models?.translator))
        }
    }

    if (translatorChanged || actionsChanged || commandsChanged) {
        Object.assign(changed, await updateAppAgentStates(context, changed));
    }
    if (changed.explainerName !== undefined) {
        try {
            context.agentCache = await getAgentCache(
                context.session,
                context.agents,
                context.logger,
            );
        } catch (e: any) {
            context.requestIO.error(`Failed to change explainer: ${e.message}`);
            delete changed.explainerName;
            // Restore old explainer name
            context.session.setConfig({
                explainerName: context.agentCache.explainerName,
            });
        }

        // New cache is recreated, not need to manually change settings.
        return changed;
    }

    // Propagate the options to the cache
    context.agentCache.constructionStore.setConfig(changed);

    // cache and auto save are handled separately
    if (changed.cache !== undefined) {
        // the cache state is changed.
        // Auto save and model is configured in configAgentCache as well.
        await configAgentCache(context.session, context.agentCache);
    } else {
        if (changed.autoSave !== undefined) {
            // Make sure the cache has a file for a persisted session
            if (changed.autoSave) {
                if (context.session.cache) {
                    const cacheDataFilePath =
                        await context.session.ensureCacheDataFilePath();
                    await context.agentCache.constructionStore.save(
                        cacheDataFilePath,
                    );
                }
            }
            await context.agentCache.constructionStore.setAutoSave(
                changed.autoSave,
            );
        }
        if (changed.models?.explainer !== undefined) {
            context.agentCache.model = changed.models.explainer;
        }
    }

    return changed;
}

export function getActiveTranslatorList(context: CommandHandlerContext) {
    return context.agents
        .getTranslatorNames()
        .filter((name) => isTranslatorActive(name, context));
}

function getActiveTranslators(context: CommandHandlerContext) {
    return Object.fromEntries(
        getActiveTranslatorList(context).map((name) => [name, true]),
    );
}

export function isTranslatorActive(
    translatorName: string,
    context: CommandHandlerContext,
) {
    return (
        context.agents.isTranslatorEnabled(translatorName) &&
        context.transientAgents[translatorName] !== false
    );
}

export function isActionActive(
    translatorName: string,
    context: CommandHandlerContext,
) {
    return (
        context.agents.isActionEnabled(translatorName) &&
        context.transientAgents[translatorName] !== false
    );
}
