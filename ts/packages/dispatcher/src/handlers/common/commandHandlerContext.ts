// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess } from "child_process";
import {
    ChildLogger,
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
    closeActionContext,
    initializeActionContext,
    updateActionContext,
} from "../../action/actionHandlers.js";
import {
    Session,
    SessionOptions,
    configAgentCache,
    defaultSessionConfig,
} from "../../session/session.js";
import {
    getDefaultTranslatorName,
    getDispatcherAgentName,
    getTranslatorNames,
    loadAgentJsonTranslator,
} from "../../translation/agentTranslators.js";
import { getCacheFactory } from "../../utils/cacheFactory.js";
import { loadTranslatorSchemaConfig } from "../../utils/loadSchemaConfig.js";
import { createServiceHost } from "../serviceHost/serviceHostCommandHandler.js";
import {
    ClientIO,
    RequestIO,
    getConsoleRequestIO,
    getRequestIO,
    RequestId,
    getNullRequestIO,
} from "./interactiveIO.js";
import { ChatHistory, createChatHistory } from "./chatHistory.js";
import { getUserId } from "../../utils/userData.js";
import { DispatcherName } from "../requestCommandHandler.js";
import { DispatcherAgent, DispatcherAgentContext } from "@typeagent/agent-sdk";
import { getDispatcherAgents } from "../../agent/agentConfig.js";
import { conversation as Conversation } from "knowledge-processor";

export interface CommandResult {
    error?: boolean;
    message?: string;
    html?: boolean;
}

// Command Handler Context definition.
export type CommandHandlerContext = {
    agents: Map<string, DispatcherAgent>;
    session: Session;
    sessionContext: Map<string, DispatcherAgentContext>;

    conversationManager?: Conversation.ConversationManager;
    // Per activation configs
    developerMode?: boolean;
    explanationAsynchronousMode: boolean;
    dblogging: boolean;
    clientIO: ClientIO | undefined | null;
    requestIO: RequestIO;

    // Runtime context
    commandLock: Limiter; // Make sure we process one command at a time.
    currentTranslatorName: string;
    translatorCache: Map<string, TypeChatJsonTranslatorWithStreaming<object>>;
    agentCache: AgentCache;
    action: { [key: string]: any };
    currentScriptDir: string;
    logger?: Logger | undefined;
    serviceHost: ChildProcess | undefined;
    localWhisper: ChildProcess | undefined;
    requestId?: RequestId;
    chatHistory: ChatHistory;
    // For @correct
    lastRequestAction?: RequestAction;
    lastExplanation?: object;
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
        config.models.translator,
        config.switch.inline ? config.translators : undefined,
        config.multipleActions,
    );
    const streamingTranslator = enableJsonTranslatorStreaming(newTranslator);
    context.translatorCache.set(translatorName, streamingTranslator);
    return newTranslator;
}

async function getAgentCache(session: Session, logger: Logger | undefined) {
    const cacheFactory = getCacheFactory();
    const explainerName = session.explainerName;
    const agentCache = cacheFactory.create(
        explainerName,
        loadTranslatorSchemaConfig,
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
    explanationAsynchronousMode?: boolean; // default to false
    persistSession?: boolean; // default to false,
    stdio?: readline.Interface;
    clientIO?: ClientIO | undefined | null; // default to console IO, null to disable
    enableServiceHost?: boolean; // default to false,
};

async function getSession(options?: InitializeCommandHandlerContextOptions) {
    let session: Session | undefined;
    const persistSession = options?.persistSession ?? false;
    if (persistSession) {
        try {
            session = await Session.restoreLastSession();
        } catch (e: any) {
            console.warn(`WARNING: ${e.message}. Creating new session.`);
        }
    }
    if (session === undefined) {
        session = await Session.create(defaultSessionConfig, persistSession);
    }

    if (options) {
        if (options.translators) {
            // for initialization, missing translators means false
            for (const name of getTranslatorNames()) {
                if (options.translators[name] === undefined) {
                    options.translators[name] = false;
                }
            }
        }

        if (options.actions) {
            // for initialization, missing translators means false
            for (const name of getTranslatorNames()) {
                if (options.actions[name] === undefined) {
                    options.actions[name] = false;
                }
            }
        }
        session.setConfig(options);
    }
    return session;
}

export async function initializeCommandHandlerContext(
    hostName: string,
    options?: InitializeCommandHandlerContextOptions,
): Promise<CommandHandlerContext> {
    const explanationAsynchronousMode =
        options?.explanationAsynchronousMode ?? false;
    const stdio = options?.stdio;

    const session = await getSession(options);
    const path = session.getSessionDirPath();
    const conversationManager = await Conversation.createConversationManager(
        "conversation",
        path ? path : "/data/testChat",
        false,
    );
    const dbLoggerSink: LoggerSink | undefined = createMongoDBLoggerSink(
        "telemetrydb",
        "dispatcherlogs",
        () => context.dblogging,
    );

    const loggerSink = new MultiSinkLogger([createDebugLoggerSink()]);

    if (dbLoggerSink !== undefined) {
        loggerSink.addSink(dbLoggerSink);
    }

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

    const clientIO = options?.clientIO;
    const agents = await getDispatcherAgents();
    const context: CommandHandlerContext = {
        agents,
        session,
        conversationManager,
        sessionContext: new Map<string, DispatcherAgentContext>(),
        explanationAsynchronousMode,
        dblogging: true,
        clientIO,
        requestIO: clientIO
            ? getRequestIO(clientIO, undefined, getDefaultTranslatorName())
            : clientIO === undefined
              ? getConsoleRequestIO(stdio)
              : getNullRequestIO(),

        // Runtime context
        commandLock: createLimiter(1), // Make sure we process one command at a time.
        agentCache: await getAgentCache(session, logger),
        currentTranslatorName: getDefaultTranslatorName(), // REVIEW: just default to the first one on initialize?
        translatorCache: new Map<string, TypeChatJsonTranslator<object>>(),
        currentScriptDir: process.cwd(),
        action: await initializeActionContext(agents),
        chatHistory: createChatHistory(),
        logger,
        serviceHost: serviceHost,
        localWhisper: undefined,
    };

    await updateActionContext(context.session.getConfig().actions, context);
    return context;
}

export async function closeCommandHandlerContext(
    context: CommandHandlerContext,
) {
    context.serviceHost?.kill();
    closeActionContext(context);
}

export async function setSessionOnCommandHandlerContext(
    context: CommandHandlerContext,
    session: Session,
) {
    context.session = session;
    for (const [name, sessionContext] of context.sessionContext.entries()) {
        getDispatcherAgent(name, context).closeAgentContext?.(sessionContext);
    }
    context.sessionContext.clear();
    context.action = await initializeActionContext(context.agents);
    context.agentCache = await getAgentCache(context.session, context.logger);
    await updateActionContext(context.session.getConfig().actions, context);
}

export async function reloadSessionOnCommandHandlerContext(
    context: CommandHandlerContext,
    persist: boolean,
) {
    const session = await getSession({ persistSession: persist });
    await setSessionOnCommandHandlerContext(context, session);
}

export async function changeContextConfig(
    options: SessionOptions,
    context: CommandHandlerContext,
) {
    const changed = context.session.setConfig(options);

    if (
        changed.translators ||
        changed.models?.translator !== undefined ||
        changed.switch?.inline ||
        changed.multipleActions
    ) {
        // The dynamic schema for change assistant is changed.
        // Clear the cache to regenerate them.
        context.translatorCache.clear();
    }

    if (changed.actions) {
        changed.actions = await updateActionContext(changed.actions, context);
    }
    if (changed.explainerName !== undefined) {
        try {
            context.agentCache = await getAgentCache(
                context.session,
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

export function getDispatcherAgent(
    dispatcherAgentName: string,
    context: CommandHandlerContext,
) {
    const dispatcherAgent = context.agents.get(dispatcherAgentName);
    if (dispatcherAgent === undefined) {
        throw new Error(
            `Invalid dispatcher agent name: ${dispatcherAgentName}`,
        );
    }
    return dispatcherAgent;
}
