// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DeepPartialUndefined,
    Limiter,
    createLimiter,
} from "@typeagent/common-utils";
import {
    ChildLogger,
    Logger,
    LoggerSink,
    MultiSinkLogger,
    createDebugLoggerSink,
    createDatabaseLoggerSink,
    CosmosContainerClientFactory,
    CosmosPartitionKeyBuilderFactory,
    PromptLogger,
    createPromptLogger,
    PromptLoggerOptions,
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
import { IndexingServiceRegistry } from "./indexingServiceRegistry.js";
import {
    getAppAgentName,
    TypeAgentTranslator,
} from "../translation/agentTranslators.js";
import { ActionConfigProvider } from "../translation/actionConfigProvider.js";
import { getCacheFactory } from "../utils/cacheFactory.js";
import { nullClientIO } from "./interactiveIO.js";
import { ClientIO, RequestId } from "@typeagent/dispatcher-types";
import { initializeGeolocation } from "./geolocation.js";
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
import { ConversationMemory } from "conversation-memory";
import {
    AppAgentManager,
    AppAgentStateInitSettings,
    AppAgentStateSettings,
    getAppAgentStateSettings,
    SetStateResult,
} from "./appAgentManager.js";
import { IPortRegistrar, PortRegistrar } from "./portRegistrar.js";
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
import { CommandResult } from "@typeagent/dispatcher-types";
import { DispatcherName } from "./dispatcher/dispatcherUtils.js";
import {
    CollisionEvent,
    createCollisionRingBuffer,
    emitCollisionEvent,
} from "./collisionTelemetry.js";
import { CollisionPreferenceStore } from "./collisionPreferences.js";
import { CollisionRegistry } from "./collisionRegistry.js";
import { ChoiceManager } from "@typeagent/agent-sdk/helpers/action";
import lockfile from "proper-lockfile";
import { IndexManager } from "./indexManager.js";
import { ActionContextWithClose } from "../execute/actionContext.js";
import { initializeMemory } from "./memory.js";
import { StorageProvider } from "../storageProvider/storageProvider.js";
import {
    AgentGrammarRegistry,
    GrammarStore as PersistedGrammarStore,
    registerBuiltInEntities,
} from "action-grammar";
import fs from "node:fs";
import { CosmosClient, PartitionKeyBuilder } from "@azure/cosmos";
import { CosmosPartitionKeyBuilder } from "telemetry";
import { DefaultAzureCredential } from "@azure/identity";
import { DisplayLog } from "../displayLog.js";
import {
    fromJSONParsedActionSchema,
    ParsedActionSchemaJSON,
} from "@typeagent/action-schema";
import { RequestQueue } from "../queue/requestQueue.js";
import type { QueueExecutionContext } from "../queue/requestQueue.js";
import { createSnapshotCoalescer } from "../queue/snapshotCoalescer.js";
import { processCommand as runProcessCommand } from "../command/command.js";

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
    readonly portRegistrar: IPortRegistrar;
    readonly agentInstaller: AppAgentInstaller | undefined;
    session: Session;

    readonly persistDir: string | undefined;
    readonly instanceDir: string | undefined; // global instance root for cross-session agent storage (config, auth tokens, user preferences)
    readonly cacheDir: string | undefined;
    readonly embeddingCacheDir: string | undefined;
    readonly storageProvider: StorageProvider | undefined;

    readonly indexManager: IndexManager;
    readonly indexingServiceRegistry: IndexingServiceRegistry | undefined;

    activityContext?: ActivityContext | undefined;
    conversationManager?: Conversation.ConversationManager | undefined;
    conversationMemory?: ConversationMemory | undefined;
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
    agentGrammarRegistry: AgentGrammarRegistry; // NFA-based grammar system for cache matching
    grammarGenerationInitialized: boolean; // Track if NFA grammar generation has been set up
    persistedGrammarStore?: PersistedGrammarStore; // Persistence layer for dynamic grammar rules
    currentScriptDir: string;
    logger?: Logger | undefined;
    currentRequestId: RequestId | undefined;
    currentAbortSignal: AbortSignal | undefined;
    activeRequests: Map<string, AbortController>;
    activeRequestsByClientId: Map<unknown, AbortController>;
    noReasoning: boolean;
    isInsideReasoningLoop: boolean; // true while the MCP execute_action handler is dispatching a sub-action
    reasoningSourceIcon?: string | undefined; // engine-specific icon override while inside a reasoning loop
    commandResult?: CommandResult | undefined;
    chatHistory: ChatHistory;
    constructionProvider?: ConstructionProvider | undefined;
    displayLog: DisplayLog;
    requestQueue: RequestQueue;

    batchMode: boolean;
    pendingChoiceRoutes: Map<
        string,
        {
            agentName: string;
            requestId: RequestId;
            actionIndex: number | undefined;
        }
    >;
    streamingActionContext?: ActionContextWithClose | undefined;
    metricsManager?: RequestMetricsManager | undefined;
    commandProfiler?: Profiler | undefined;
    promptLogger?: PromptLogger | undefined;

    instanceDirLock: (() => Promise<void>) | undefined;

    userRequestKnowledgeExtraction: boolean;
    actionResultEntityStorage: boolean; // store entities in chat history (fast)
    actionResultKnowledgeExtraction: boolean; // also push to conversationManager/conversationMemory (slow LLM)

    // Ring buffer of recent collision-detection events. Bounded; see collisionTelemetry.ts.
    collisionEvents: CollisionEvent[];
    // True while a MultipleAction batch is being executed; consulted by the
    // collision resolver to apply collision.multipleActionBehavior.
    executingMultipleAction: boolean;
    // Tier 1 of the two-tier collision flow: profile-scoped "the user always
    // picks X" preferences. Loaded once at context init.
    collisionPreferences: CollisionPreferenceStore;
    // Tier 2 "known-ambiguous" registry (neighborhoods.json). Loaded lazily
    // from collision.preference.registryPath; rebuilt when the path changes.
    collisionRegistry: CollisionRegistry;
    // The registry path the loaded `collisionRegistry` was built from, so we
    // can detect config changes and reload.
    collisionRegistryPath: string;
    // Drives the interactive `preference-clarify` card (candidate pick +
    // "remember this" checkbox). The dispatcher AppAgent's handleChoice
    // delegates back to this manager.
    collisionChoiceManager: ChoiceManager;
    // One-shot resolution overrides as a set of chosen member ids
    // ("schema.action"). Set just before re-running the original request from
    // a clarify pick so the re-translation resolves deterministically to the
    // chosen candidate; consumed on first read. Covers the "don't remember"
    // case (no durable preference written).
    collisionOneShotPicks: Set<string>;
};

export function getRequestId(context: CommandHandlerContext): RequestId {
    const requestId = context.currentRequestId;
    if (requestId === undefined) {
        throw new Error("Internal Error: RequestId is not set in the context.");
    }
    return requestId;
}

export function requestIdToString(requestId: RequestId): string {
    return requestId.requestId;
}

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
 * - allowSharedLocalView: The list of agent names that can get the ports of all other agent's port. Default is undefined.
 *   Ports are assigned dynamically by the OS (listen on port 0) to avoid conflicts when multiple sessions start concurrently.
 *   Each agent's view server reports its bound port back to the dispatcher via IPC, which stores it via setLocalHostPort().
 *
 * Logging options:
 * - metrics: whether to enable collection of timing metrics. Default is false.
 * - collectCommandResult: whether to collect command result in the return for `processCommand`. Default is false.
 * - dblogging: whether to enable database telemetry logging. Default is true; pass false to opt out.
 * - traceId: An optional trace ID to use for logging identification.
 */
export type DispatcherOptions = DeepPartialUndefined<DispatcherConfig> & {
    // Core options
    appAgentProviders?: AppAgentProvider[];
    persistDir?: string | undefined; // the directory to save state.
    instanceDir?: string | undefined; // global instance directory for cross-session agent storage (config, auth tokens, user preferences). When omitted, falls back to persistDir.
    persistSession?: boolean; // default to false,
    storageProvider?: StorageProvider | undefined;

    clientIO?: ClientIO | undefined; // required for interactivity, undefined to disable any IO.

    // Initial state settings
    agents?: AppAgentStateInitSettings;

    // Agent port assignments
    allowSharedLocalView?: string[]; // agents that can access any shared local views, default to undefined

    /**
     * Optional pre-built {@link PortRegistrar} the host (e.g. agentServer)
     * shares across all dispatchers in the process so external clients can
     * discover any agent's port regardless of which conversation it's
     * loaded into. If omitted, each dispatcher creates its own
     * process-private registrar — the right default for standalone
     * hosts (shell, CLI) that don't expose external discovery.
     */
    portRegistrar?: IPortRegistrar;

    // Indexing service discovery
    indexingServiceRegistry?: IndexingServiceRegistry; // registry for indexing service discovery

    // Agent specific initialization options.
    agentInitOptions?: Record<string, unknown>; // agent specific initialization options.

    // Logging options
    metrics?: boolean; // default to false
    collectCommandResult?: boolean; // default to false
    dblogging?: boolean; // default to true
    traceId?: string; // optional additional for logging identification

    // Additional integration options
    agentInstaller?: AppAgentInstaller;
    constructionProvider?: ConstructionProvider;
    explanationAsynchronousMode?: boolean; // default to true

    // Use for tests so that embedding can be cached without 'persistDir'
    embeddingCacheDir?: string | undefined; // default to 'cache' under 'persistDir' if specified

    conversationMemorySettings?: {
        requestKnowledgeExtraction?: boolean;
        actionResultEntityStorage?: boolean;
        actionResultKnowledgeExtraction?: boolean;
    };
};

async function getSession(
    instanceDir?: string,
    indexingServiceRegistry?: IndexingServiceRegistry,
) {
    let session: Session | undefined;
    if (instanceDir !== undefined) {
        try {
            session = await Session.restoreLastSession(
                instanceDir,
                indexingServiceRegistry,
            );
        } catch (e: any) {
            debugError(`WARNING: ${e.message}. Creating new session.`);
        }
    }
    if (session === undefined) {
        // fill in the translator/action later.
        session = await Session.create(
            undefined,
            instanceDir,
            indexingServiceRegistry,
        );
    }
    return session;
}

function getCosmosFactories(): PromptLoggerOptions {
    const cosmosConnectionString = process.env["COSMOSDB_CONNECTION_STRING"];
    let cosmosContainerFactory: CosmosContainerClientFactory | undefined;
    let cosmosPartitionKeyBuilderFactory:
        | CosmosPartitionKeyBuilderFactory
        | undefined;

    if (cosmosConnectionString && cosmosConnectionString !== "") {
        cosmosContainerFactory = async (endpoint, dbName, containerName) => {
            const client = new CosmosClient({
                endpoint,
                aadCredentials: new DefaultAzureCredential(),
            });
            const container = client.database(dbName).container(containerName);
            return {
                executeBulkOperations: (ops) =>
                    container.items.executeBulkOperations(ops as any),
            };
        };

        cosmosPartitionKeyBuilderFactory = () =>
            new PartitionKeyBuilder() as unknown as CosmosPartitionKeyBuilder;
    }

    const result: PromptLoggerOptions = {};
    if (cosmosContainerFactory !== undefined) {
        result.cosmosContainerFactory = cosmosContainerFactory;
    }
    if (cosmosPartitionKeyBuilderFactory !== undefined) {
        result.cosmosPartitionKeyBuilderFactory =
            cosmosPartitionKeyBuilderFactory;
    }
    return result;
}

function getLoggerSink(isDbEnabled: () => boolean, clientIO: ClientIO) {
    const debugLoggerSink = createDebugLoggerSink();
    let dbLoggerSink: LoggerSink | undefined;

    try {
        const { cosmosContainerFactory, cosmosPartitionKeyBuilderFactory } =
            getCosmosFactories();

        dbLoggerSink = createDatabaseLoggerSink({
            dbName: "telemetrydb",
            collectionName: "dispatcherlogs",
            isEnabled: isDbEnabled,
            onErrorDisable: (e: string) => {
                clientIO.notify(
                    undefined,
                    AppAgentEvent.Warning,
                    e,
                    DispatcherName,
                );
            },
            cosmosContainerFactory: cosmosContainerFactory,
            cosmosPartitionKeyBuilderFactory: cosmosPartitionKeyBuilderFactory,
        });
    } catch (e) {
        clientIO.notify(
            undefined,
            AppAgentEvent.Warning,
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

        const useNFAGrammar =
            context.session.getConfig().cache.grammarSystem === "nfa";

        const inlineAppProvider = createBuiltinAppAgentProvider(context);
        await context.agents.addProvider(
            inlineAppProvider,
            context.agentCache.grammarStore,
            embeddingCache,
            context.agentGrammarRegistry,
            useNFAGrammar,
        );

        if (appAgentProviders) {
            // onSchemaReady path: rerun collision detection in degraded mode so
            // a slow agent can never throw and crash an active session.
            const stateRefreshFn = async () => {
                await setAppAgentStates(context);
                try {
                    await runStaticCollisionDetection(context, true);
                } catch (e) {
                    debugError(`Async static collision detection failed: ${e}`);
                }
            };
            for (const provider of appAgentProviders) {
                await context.agents.addProvider(
                    provider,
                    context.agentCache.grammarStore,
                    embeddingCache,
                    context.agentGrammarRegistry,
                    useNFAGrammar,
                    stateRefreshFn,
                );
            }
        }
        // Initial-path collision detection. Honors strategy="error" — a static
        // collision will throw and prevent the dispatcher from coming up dirty.
        await runStaticCollisionDetection(context, false);
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
    const useNFAGrammar =
        context.session.getConfig().cache.grammarSystem === "nfa";

    // Don't use embedding cache for a new agent.
    await context.agents.addProvider(
        provider,
        context.agentCache.grammarStore,
        undefined,
        context.agentGrammarRegistry,
        useNFAGrammar,
    );

    await setAppAgentStates(context);
    // Re-run collision detection now that a new agent has been installed.
    // Degrade to warn — installing into a live session must never crash it.
    try {
        await runStaticCollisionDetection(context, true);
    } catch (e) {
        debugError(`Post-install collision detection failed: ${e}`);
    }

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
        options?.explanationAsynchronousMode ?? true; // default to async mode for faster command responses

    const persistSession = options?.persistSession ?? false;
    const persistDir = options?.persistDir;
    const instanceDir = options?.instanceDir; // global instance root; falls back to persistDir when absent
    const storageProvider = options?.storageProvider;
    if (persistSession && persistDir === undefined) {
        throw new Error(
            "Persist session requires persistDir to be set in options.",
        );
    }
    if (
        (persistDir !== undefined || instanceDir !== undefined) &&
        storageProvider === undefined
    ) {
        throw new Error(
            "persistDir and instanceDir require storageProvider to be set in options.",
        );
    }

    const instanceDirLock = persistDir
        ? await lockInstanceDir(persistDir)
        : undefined;

    try {
        const session = await getSession(
            persistSession ? persistDir : undefined,
            options?.indexingServiceRegistry,
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
            traceId: options?.traceId,
            sessionId: () =>
                context.session.sessionDirPath
                    ? getSessionName(context.session.sessionDirPath)
                    : undefined,
            activationId: randomUUID(),
        });

        const cacheDir = persistDir ? ensureCacheDir(persistDir) : undefined;
        const embeddingCacheDir = options?.embeddingCacheDir;
        if (embeddingCacheDir) {
            ensureDirectory(embeddingCacheDir);
        }
        const portRegistrar = options?.portRegistrar ?? new PortRegistrar();
        const agents = new AppAgentManager(
            cacheDir,
            portRegistrar,
            options?.allowSharedLocalView,
            options?.agentInitOptions,
        );
        const constructionProvider = options?.constructionProvider;
        const context: CommandHandlerContext = {
            agents,
            portRegistrar,
            agentInstaller: options?.agentInstaller,
            session,
            persistDir,
            instanceDir,
            cacheDir,
            embeddingCacheDir,
            storageProvider,
            explanationAsynchronousMode,
            dblogging: options?.dblogging ?? true,
            clientIO,

            // Runtime context
            commandLock: createLimiter(1), // Make sure we process one command at a time.
            currentRequestId: undefined,
            currentAbortSignal: undefined,
            activeRequests: new Map<string, AbortController>(),
            activeRequestsByClientId: new Map<unknown, AbortController>(),
            noReasoning: false,
            isInsideReasoningLoop: false,
            reasoningSourceIcon: undefined,
            pendingToggleTransientAgents: [],
            agentCache: await getAgentCache(
                session,
                agents,
                constructionProvider,
                logger,
            ),
            agentGrammarRegistry: new AgentGrammarRegistry(), // NFA-based grammar system
            grammarGenerationInitialized: false, // Track if NFA grammar generation has been set up
            lastActionSchemaName: DispatcherName,
            translatorCache: new Map<string, TypeAgentTranslator>(),
            currentScriptDir: process.cwd(),
            chatHistory: createChatHistory(
                session.getConfig().execution.history,
            ),
            displayLog: await DisplayLog.load(persistDir),
            logger,
            metricsManager: metrics ? new RequestMetricsManager() : undefined,
            promptLogger: createPromptLogger(getCosmosFactories()),
            batchMode: false,
            pendingChoiceRoutes: new Map(),
            instanceDirLock,
            constructionProvider,
            collectCommandResult: options?.collectCommandResult ?? false,
            indexManager: IndexManager.getInstance(),
            indexingServiceRegistry: options?.indexingServiceRegistry,

            // TODO: instead of disabling this let's find a way to gracefully handle this
            // when there is no internet
            userRequestKnowledgeExtraction:
                options?.conversationMemorySettings
                    ?.requestKnowledgeExtraction ?? true,
            actionResultEntityStorage:
                options?.conversationMemorySettings
                    ?.actionResultEntityStorage ?? true,
            actionResultKnowledgeExtraction:
                options?.conversationMemorySettings
                    ?.actionResultKnowledgeExtraction ?? true,

            collisionEvents: createCollisionRingBuffer(),
            executingMultipleAction: false,
            collisionPreferences: CollisionPreferenceStore.load(instanceDir),
            collisionRegistry: CollisionRegistry.load(
                session.getConfig().collision.preference.registryPath,
            ),
            collisionRegistryPath:
                session.getConfig().collision.preference.registryPath,
            collisionChoiceManager: new ChoiceManager(),
            collisionOneShotPicks: new Set(),
            // Replaced below; the queue's broadcaster needs `context` to be
            // available so it can route through `context.clientIO`.
            requestQueue: undefined as unknown as RequestQueue,
        };

        const snapshotCoalescer = createSnapshotCoalescer((snapshot) => {
            context.clientIO.queueStateChanged?.(snapshot);
        });
        context.requestQueue = new RequestQueue(
            async (qctx: QueueExecutionContext) => {
                const reqId: RequestId = {
                    connectionId: qctx.originatorConnectionId || undefined,
                    requestId: qctx.requestId,
                    clientRequestId: qctx.clientRequestId,
                };
                const result = await runProcessCommand(
                    qctx.text,
                    context,
                    reqId,
                    qctx.attachments,
                    qctx.options,
                );
                try {
                    context.displayLog.logCommandResult(
                        reqId,
                        result?.metrics,
                        result?.tokenUsage,
                        result?.actionTokenUsage,
                    );
                    context.displayLog.saveQueued();
                } catch {
                    // best-effort
                }
                try {
                    context.clientIO.notify(
                        reqId,
                        "commandComplete",
                        { result: result ?? null },
                        "system",
                    );
                } catch {
                    // best-effort
                }
                return result;
            },
            {
                requestQueued: (entry, version) => {
                    context.clientIO.requestQueued?.(entry, version);
                },
                requestStarted: (entry, version) => {
                    context.clientIO.requestStarted?.(entry, version);
                },
                requestCancelled: (rid, reason, version) => {
                    context.clientIO.requestCancelled?.(rid, reason, version);
                },
                queueStateChanged: (snapshot) => {
                    snapshotCoalescer.schedule(snapshot);
                },
            },
            context.logger
                ? {
                      logEvent: (name, data) =>
                          context.logger?.logEvent(name, data as any),
                  }
                : undefined,
        );

        await initializeMemory(context, sessionDirPath);
        await addAppAgentProviders(context, options?.appAgentProviders);

        // Initialize geolocation in the background (non-blocking)
        initializeGeolocation().catch(() => {});

        // Initialize grammar generation if using NFA system
        await setupGrammarGeneration(context);

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

/**
 * Run static action-collision detection (exact-name + fuzzy/semantic) against
 * all currently loaded agents. Honors session config:
 *   collision.static.detect / collision.static.strategy
 *   collision.fuzzy.detect / collision.fuzzy.staticEnabled / .scorer / .similarityThreshold
 *
 * @param degradeToWarn If true, the static.strategy="error" mode is downgraded
 * to "warn". Used by the onSchemaReady path so a slow agent can never crash a
 * live session.
 */
export async function runStaticCollisionDetection(
    context: CommandHandlerContext,
    degradeToWarn: boolean,
): Promise<void> {
    const cfg = context.session.getConfig().collision;
    const startedAt = performance.now();

    if (cfg.static.detect) {
        const collisions = context.agents.scanActionNameCollisions();
        if (collisions.length > 0) {
            const summary = collisions
                .map(
                    (c) =>
                        `${c.actionName} -> [${c.occurrences
                            .map((o) => `${o.agentName}:${o.schemaName}`)
                            .join(", ")}]`,
                )
                .join("; ")
                .slice(0, 500);
            const effective =
                cfg.static.strategy === "error" && !degradeToWarn
                    ? "error"
                    : "warn";
            for (const c of collisions) {
                emitCollisionEvent(
                    {
                        kind: "static",
                        candidates: c.occurrences.map((o) => ({
                            schemaName: o.schemaName,
                            actionName: c.actionName,
                        })),
                        strategy: effective,
                        elapsedMs: performance.now() - startedAt,
                    },
                    context,
                );
            }
            if (effective === "error") {
                throw new Error(
                    `Action collision detected across agents: ${summary}`,
                );
            }
            debug(
                `[collision.static] ${collisions.length} collision(s) found: ${summary}`,
            );
        }
    }

    if (cfg.fuzzy.detect && cfg.fuzzy.staticEnabled) {
        const fuzzy = await context.agents.runStaticFuzzyScan(
            cfg.fuzzy.scorer,
            cfg.fuzzy.similarityThreshold,
        );
        for (const c of fuzzy) {
            emitCollisionEvent(
                {
                    kind: "fuzzy",
                    candidates: [
                        {
                            schemaName: c.a.schemaName,
                            actionName: c.a.actionName,
                        },
                        {
                            schemaName: c.b.schemaName,
                            actionName: c.b.actionName,
                        },
                    ],
                    strategy: cfg.fuzzy.strategy,
                    elapsedMs: performance.now() - startedAt,
                    note: `similarity=${c.similarity.toFixed(3)}`,
                },
                context,
            );
        }
    }
}

async function setAppAgentStates(context: CommandHandlerContext) {
    const result = await context.agents.setState(
        context,
        context.session.getConfig(),
    );

    // Only rollback if user explicitly change state.
    // Ignore the returned rollback state for initialization and keep the session setting as is.
    // Use debug logging instead of notify for startup failures - don't bother user with unconfigured agents

    const rollback = processSetAppAgentStateResult(result, context, (message) =>
        debug(`Startup: ${message}`),
    );

    if (rollback) {
        context.session.updateConfig(rollback);
    }
}

async function setupGrammarGeneration(context: CommandHandlerContext) {
    const config = context.session.getConfig();
    const useNFAGrammar = config.cache.grammarSystem === "nfa";

    if (!useNFAGrammar || !config.cache.grammar) {
        return;
    }

    // Register built-in entity types (Ordinal, Cardinal, CalendarDate, etc.)
    registerBuiltInEntities();

    // Initialize persisted grammar store
    const grammarStorePath = context.session.getGrammarStoreFilePath();
    if (!grammarStorePath) {
        debug("No session dir path, skipping grammar store initialization");
        return;
    }

    const grammarStore = new PersistedGrammarStore();

    // Load or create grammar store
    if (fs.existsSync(grammarStorePath)) {
        try {
            await grammarStore.load(grammarStorePath);
            debug(`Loaded grammar store from ${grammarStorePath}`);

            // Merge persisted dynamic rules into agent grammars
            const allRules = grammarStore.getAllRules();
            const schemaRules = new Map<string, string[]>();

            // Group rules by schema
            for (const rule of allRules) {
                if (!schemaRules.has(rule.schemaName)) {
                    schemaRules.set(rule.schemaName, []);
                }
                schemaRules.get(rule.schemaName)!.push(rule.grammarText);
            }

            // Merge rules into each agent's grammar one at a time.
            // Adding individually ensures one bad rule doesn't prevent
            // all other rules for that schema from loading.
            for (const [schemaName, rules] of schemaRules) {
                const agentGrammar =
                    context.agentGrammarRegistry.getAgent(schemaName);
                if (!agentGrammar) {
                    debug(
                        `Schema ${schemaName} has persisted rules but no registered agent`,
                    );
                    continue;
                }

                let merged = 0;
                let failed = 0;
                for (const ruleText of rules) {
                    const result = agentGrammar.addGeneratedRules(ruleText);
                    if (result.success) {
                        merged++;
                    } else {
                        failed++;
                        debug(
                            `Skipping bad rule for ${schemaName}: ${result.errors.join("; ")}`,
                        );
                    }
                }
                debug(
                    `Merge ${schemaName}: ${merged} merged, ${failed} failed (of ${rules.length})`,
                );
                if (merged > 0) {
                    // Sync to grammar store used for matching
                    context.agentCache.syncAgentGrammar(schemaName);
                }
            }
        } catch (error) {
            debug(`Failed to load grammar store: ${error}`);
            await grammarStore.newStore(grammarStorePath);
        }
    } else {
        await grammarStore.newStore(grammarStorePath);
    }

    // Expose the persistence store on the context for management actions
    context.persistedGrammarStore = grammarStore;

    // Enable auto-save
    await grammarStore.setAutoSave(config.cache.autoSave);

    // Import getPackageFilePath for resolving schema paths
    const { getPackageFilePath } = await import(
        "../utils/getPackageFilePath.js"
    );

    // Configure agent cache with grammar generation support
    context.agentCache.configureGrammarGeneration(
        context.agentGrammarRegistry,
        grammarStore,
        true,
        (schemaName: string) => {
            // Get compiled schema file path (.pas.json) from action config for grammar generation
            const actionConfig = context.agents.tryGetActionConfig(schemaName);
            if (!actionConfig) {
                throw new Error(
                    `Action config not found for schema: ${schemaName}`,
                );
            }

            let schemaPath: string | undefined;

            // Use schemaFilePath directly if it's already a .pas.json file
            if (
                actionConfig.schemaFilePath &&
                actionConfig.schemaFilePath.endsWith(".pas.json")
            ) {
                schemaPath = getPackageFilePath(actionConfig.schemaFilePath);
            } else if (
                actionConfig.schemaFilePath &&
                actionConfig.schemaFilePath.endsWith(".ts")
            ) {
                // Fallback: try to derive .pas.json path from .ts schemaFilePath
                // Try common pattern: ./src/schema.ts -> ../dist/schema.pas.json
                const derivedPath = actionConfig.schemaFilePath
                    .replace(/^\.\/src\//, "../dist/")
                    .replace(/\.ts$/, ".pas.json");
                debug(
                    `Attempting fallback .pas.json path for ${schemaName}: ${derivedPath}`,
                );
                try {
                    schemaPath = getPackageFilePath(derivedPath);
                } catch {
                    // Fallback path doesn't exist, continue to error
                }
            }

            if (!schemaPath) {
                throw new Error(
                    `Compiled schema file path (.pas.json) not found for schema: ${schemaName}. ` +
                        `Please ensure the schema is compiled to a .pas.json file.`,
                );
            }

            const content = fs.readFileSync(schemaPath, "utf-8");
            return fromJSONParsedActionSchema(
                JSON.parse(content) as ParsedActionSchemaJSON,
            );
        },
    );

    // Sync all registered agent grammars to the grammar store
    // This ensures agents without dynamic rules also get their base grammar in the store
    // IMPORTANT: Must happen AFTER configureGrammarGeneration so the cache knows about the registry
    const registeredAgents = context.agentGrammarRegistry.getAllAgentIds();
    debug(`Syncing ${registeredAgents.length} agent grammars to store`);
    for (const schemaName of registeredAgents) {
        context.agentCache.syncAgentGrammar(schemaName);
    }

    // Enable DFA if configured (NFA must be active first, which it now is)
    if (config.cache.useDFA) {
        context.agentCache.grammarStore.setUseDFA(true);
        debug("DFA matching enabled");
    }

    // Mark as initialized to prevent re-initialization
    context.grammarGenerationInitialized = true;
    debug("Grammar generation configured for NFA system");
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
                    ? systemContext.agents.getAppAgentEmoji(
                          getAppAgentName(schemaName),
                      )
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
    // Drain in-flight/queued entries before tearing down agents.
    try {
        await context.requestQueue.drainAndStop();
    } catch {
        // best-effort
    }
    // Save the session because the token count is in it.
    context.session.save();
    await context.agents.close();
    if (context.instanceDirLock) {
        await context.instanceDirLock();
    }
}

export async function setSessionOnCommandHandlerContext(
    context: CommandHandlerContext,
    session: Session,
) {
    context.session = session;
    await context.agents.close();

    await initializeMemory(context, session.getSessionDirPath());
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

        // If grammar system changed to NFA and not already initialized, set up grammar generation
        if (
            changed.cache.grammarSystem === "nfa" &&
            !systemContext.grammarGenerationInitialized
        ) {
            await setupGrammarGeneration(systemContext);
        }

        // If useDFA toggled at runtime (only takes effect when NFA grammar system is active)
        if (
            changed.cache.useDFA !== undefined &&
            systemContext.grammarGenerationInitialized
        ) {
            agentCache.grammarStore.setUseDFA(changed.cache.useDFA);
        }
    }

    // cache and auto save are handled separately
    if (changed.cache?.enabled !== undefined) {
        // the cache state is changed.
        // Auto save, model and builtInCache is configured in setupAgentCache as well.
        await setupAgentCache(
            session,
            agentCache,
            systemContext.constructionProvider,
            systemContext.agentGrammarRegistry,
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

    if (changed.cache?.grammar !== undefined) {
        agentCache.grammarStore.setEnabled(changed.cache.grammar);
    }

    return changed;
}
