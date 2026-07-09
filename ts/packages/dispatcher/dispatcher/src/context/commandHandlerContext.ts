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
import {
    ClientIO,
    RequestId,
    ProcessCommandOptions,
} from "@typeagent/dispatcher-types";
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
    AppAgentProvider,
    AppAgentHost,
    AppAgentSource,
    AppAgentConnection,
    ConstructionProvider,
} from "../agentProvider/agentProvider.js";
import {
    AppAgentHostApplicator,
    AppAgentHostApplyFns,
} from "./appAgentHost.js";
import { getSchemaNamePrefix } from "../execute/actionHandlers.js";
import { RequestMetricsManager } from "../utils/metrics.js";
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
import {
    ConversationSignalSource,
    RingBufferSignalSource,
} from "./contextSelector/conversationSignal.js";
import {
    KeywordIndex,
    agentSchemaSource,
} from "./contextSelector/keywordIndex.js";
import { KeywordSidecar } from "./contextSelector/keywordSidecar.js";
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
} from "@typeagent/action-grammar";
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

/** Progress update emitted once per session during a Copilot import. */
export type CopilotImportProgress = {
    /** 1-based index of the session currently being processed. */
    current: number;
    /** Total sessions being processed in this run. */
    total: number;
    /** Display name of the session currently being processed. */
    name: string;
};

/** Summary returned when a Copilot import completes. */
export type CopilotImportSummary = {
    total: number;
    imported: number;
    skipped: number;
    /** Existing mirrors whose name was reconciled to the current VS Code title. */
    renamed: number;
    failed: number;
};

/**
 * Host capability that imports GitHub Copilot Chat sessions as conversation
 * mirrors, invoking `onProgress` once per session so the caller can stream
 * status to the user.
 */
export type CopilotImporter = (
    onProgress?: (progress: CopilotImportProgress) => void,
) => Promise<CopilotImportSummary>;

// Command Handler Context definition.
export type CommandHandlerContext = {
    readonly agents: AppAgentManager;
    readonly portRegistrar: IPortRegistrar;
    // The per-dispatcher AppAgentHost applicator: an
    // idle-gated FIFO add/remove surface connected AppAgentSources use to mutate
    // this session's live agent set. This instance is placed into the
    // host-owned `@package` agent's own agentContext.
    appAgentHost: AppAgentHostApplicator;
    // Live connections to the injected AppAgentSources. Disposed at context
    // teardown, which deregisters this host from each source's registry without
    // tearing down the shared provider instances.
    readonly appAgentConnections: AppAgentConnection[];
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
    /**
     * Host-provided enumeration of sibling conversations (id + name), used to
     * offer `@conversation switch/rename/delete` name completions. Undefined
     * for standalone hosts that don't manage multiple conversations.
     */
    readonly getConversationList?:
        | (() => { conversationId: string; name: string }[])
        | undefined;
    /**
     * Host-provided capability to import GitHub Copilot Chat sessions as
     * conversation mirrors, streaming per-session progress. Injected by the
     * agent-server (which owns the ConversationManager + session-store
     * reader); undefined for hosts that can't import (e.g. standalone local
     * mode).
     */
    readonly copilotImport?: CopilotImporter | undefined;
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
    currentOptions?: ProcessCommandOptions | undefined;
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

    // contextSelector (§11). The conversation signal source (produces the
    // per-turn context vector), the effective-keyword index (derived floor +
    // sidecar overrides), and the live-tunable keyword sidecar it reads.
    conversationSignal: ConversationSignalSource;
    contextSelectorKeywords: KeywordIndex;
    contextSelectorSidecar: KeywordSidecar;
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
    // Dynamic (installed) agent sources. Each is connected once per dispatcher
    // at context init; `connect()` vends the provider(s) to register and a
    // teardown handle, and lets the source fan out live install/uninstall to
    // this session.
    appAgentSources?: AppAgentSource[];
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
    constructionProvider?: ConstructionProvider;
    explanationAsynchronousMode?: boolean; // default to true

    // Use for tests so that embedding can be cached without 'persistDir'
    embeddingCacheDir?: string | undefined; // default to 'cache' under 'persistDir' if specified

    conversationMemorySettings?: {
        requestKnowledgeExtraction?: boolean;
        actionResultEntityStorage?: boolean;
        actionResultKnowledgeExtraction?: boolean;
    };

    /**
     * Optional callback letting the host (e.g. agentServer's
     * ConversationManager) expose the set of sibling conversations to the
     * dispatcher — used to offer name completions for `@conversation
     * switch/rename/delete`. Omitted by standalone hosts that have a single
     * conversation.
     */
    getConversationList?:
        | (() => { conversationId: string; name: string }[])
        | undefined;

    /**
     * Optional capability letting the host import GitHub Copilot Chat sessions
     * as conversation mirrors, streaming per-session progress. Injected by the
     * agent-server; omitted by hosts without a ConversationManager.
     */
    copilotImport?: CopilotImporter | undefined;
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

/**
 * Whether an app agent is currently "on" in this session:
 * either its command surface is enabled or any of its schemas is enabled. Used
 * to word the add/reconcile notification (enabled vs. disabled).
 */
function isAgentEnabled(context: CommandHandlerContext, name: string): boolean {
    const agents = context.agents;
    try {
        if (agents.isCommandEnabled(name)) {
            return true;
        }
    } catch {
        // Agent has no command surface / not loaded — fall through to schemas.
    }
    for (const schemaName of agents.getSchemaNames()) {
        if (getAppAgentName(schemaName) === name) {
            try {
                if (agents.isSchemaEnabled(schemaName)) {
                    return true;
                }
            } catch {
                // Ignore invalid schema name.
            }
        }
    }
    return false;
}

/**
 * Add agent names to this session's persisted known set so
 * a later load reconciles against an accurate baseline. No-op before the
 * baseline is established (reconciliation records it at load).
 */
function addKnownAgents(
    context: CommandHandlerContext,
    names: readonly string[],
): void {
    const known = context.session.getKnownAgents();
    if (known === undefined) {
        return;
    }
    const next = new Set(known);
    for (const name of names) {
        next.add(name);
    }
    context.session.setKnownAgents([...next]);
}

/**
 * Remove agent names from this session's persisted known set. No-op before the
 * baseline is established.
 */
function removeKnownAgents(
    context: CommandHandlerContext,
    names: readonly string[],
): void {
    const known = context.session.getKnownAgents();
    if (known === undefined) {
        return;
    }
    const drop = new Set(names);
    context.session.setKnownAgents(known.filter((n) => !drop.has(n)));
}

/**
 * Drop the persisted enable preference for the given agent(s) from session
 * config: an explicit `@package uninstall` clears the
 * schema/action/command overrides so a fresh reinstall starts from the manifest
 * default. (Reconciliation-removal, by contrast, leaves the entry dormant.)
 * `schemaNames` must be captured BEFORE the provider is removed, since the
 * manager no longer knows them afterward.
 */
function dropAgentConfig(
    context: CommandHandlerContext,
    agentNames: readonly string[],
    schemaNames: readonly string[],
): void {
    const schemas: Record<string, null> = {};
    const actions: Record<string, null> = {};
    const commands: Record<string, null> = {};
    for (const schemaName of schemaNames) {
        schemas[schemaName] = null;
        actions[schemaName] = null;
    }
    for (const name of agentNames) {
        commands[name] = null;
    }
    context.session.updateSettings({ schemas, actions, commands });
}

/**
 * Emit the cross-session fan-out system message for a single add/remove:
 * name the agent and its resulting state so the change is
 * visible, not silent. Exported for unit testing of the wording/visibility.
 */
export function emitAgentChangeNotification(
    clientIO: ClientIO,
    op: "add" | "remove",
    provider: AppAgentProvider,
    enable: boolean,
) {
    for (const name of provider.getAppAgentNames()) {
        const message =
            op === "remove"
                ? `Agent '${name}' was removed.`
                : enable
                  ? `Agent '${name}' was added — enabled.`
                  : `Agent '${name}' was added — disabled (\`@config agent ${name}\` to enable).`;
        clientIO.notify(undefined, AppAgentEvent.Info, message, DispatcherName);
    }
}

/**
 * Reconcile this session's persisted known agent set against what is actually
 * available now. Agents that appeared while the session was
 * offline are reported as added (adopting their manifest default); agents that
 * disappeared are reported as removed (their enable preference stays dormant in
 * config). The first time a session has no recorded baseline (brand-new session,
 * or first load after upgrading to a build that tracks this) it records a silent
 * baseline. The known set is persisted so the next load reconciles accurately.
 */
export function reconcileKnownAgents(context: CommandHandlerContext): void {
    const available = context.agents.getAppAgentNames();
    const known = context.session.getKnownAgents();
    if (known === undefined) {
        // No baseline yet: adopt the current set silently.
        context.session.setKnownAgents(available);
        return;
    }
    const knownSet = new Set(known);
    const availableSet = new Set(available);
    const added = available.filter((n) => !knownSet.has(n));
    const removed = known.filter((n) => !availableSet.has(n));
    if (added.length !== 0 || removed.length !== 0) {
        const parts: string[] = [];
        for (const name of added) {
            parts.push(
                isAgentEnabled(context, name)
                    ? `${name} added — enabled`
                    : `${name} added — disabled (\`@config agent ${name}\` to enable)`,
            );
        }
        for (const name of removed) {
            parts.push(`${name} removed`);
        }
        context.clientIO.notify(
            undefined,
            AppAgentEvent.Info,
            `Agent set changed: ${parts.join("; ")}.`,
            DispatcherName,
        );
    }
    context.session.setKnownAgents(available);
}

/**
 * The {@link AppAgentHost.addProvider} body: register
 * the provider (deriving its enabled state from session config with the manifest
 * default as fallback, via {@link installAppProvider}), record it in the known
 * set, and — on a sibling fan-out (`notify`) — show a system message naming
 * the agent and its resulting state. Runs through the idle-gated applicator.
 */
async function hostAddProvider(
    context: CommandHandlerContext,
    provider: AppAgentProvider,
    notify: boolean,
) {
    await installAppProvider(context, provider);

    // Record the newly-added agent(s) so a later load reconciles accurately.
    addKnownAgents(context, provider.getAppAgentNames());

    // Sibling fan-out notification: show a system message naming
    // the agent and its resulting (config/manifest-derived) state.
    if (notify) {
        const name = provider.getAppAgentNames()[0];
        emitAgentChangeNotification(
            context.clientIO,
            "add",
            provider,
            isAgentEnabled(context, name),
        );
    }
}

/**
 * The {@link AppAgentHost.removeProvider} body: tear down a
 * previously-added provider by identity via the {@link AppAgentManager}
 * removeProvider primitive, and forget it from the known set. Runs through the
 * idle-gated applicator. On a sibling fan-out (`notify`), surfaces
 * a system message.
 *
 * `dropConfig`: when true (explicit `@package uninstall`), also
 * clears the agent's persisted enable preference so a fresh reinstall starts
 * from the manifest default. An `@package update` passes `false` so the remove leg of
 * its remove-then-add swap leaves the user's per-session preference intact
 * across a version bump.
 */
async function hostRemoveProvider(
    context: CommandHandlerContext,
    provider: AppAgentProvider,
    notify: boolean,
    dropConfig: boolean,
) {
    const names = provider.getAppAgentNames();
    // Capture the agent's schema names before removal so we can clear their
    // persisted config entries afterward.
    const schemaNames = context.agents
        .getSchemaNames()
        .filter((s) => names.includes(getAppAgentName(s)));

    await context.agents.removeProvider(
        provider,
        context.agentCache.grammarStore,
    );

    if (dropConfig) {
        dropAgentConfig(context, names, schemaNames);
    }
    removeKnownAgents(context, names);

    if (notify) {
        emitAgentChangeNotification(
            context.clientIO,
            "remove",
            provider,
            false,
        );
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
    let contextForCleanup: CommandHandlerContext | undefined;

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
            // Assigned just below once `context` exists (the apply closures need
            // it); mirrors how `requestQueue` is wired.
            appAgentHost: undefined as unknown as AppAgentHostApplicator,
            appAgentConnections: [],
            session,
            persistDir,
            instanceDir,
            cacheDir,
            embeddingCacheDir,
            storageProvider,
            explanationAsynchronousMode,
            dblogging: options?.dblogging ?? true,
            clientIO,
            getConversationList: options?.getConversationList,
            copilotImport: options?.copilotImport,

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
            conversationSignal: new RingBufferSignalSource(
                () => session.getConfig().collision.contextSelector,
            ),
            contextSelectorSidecar: KeywordSidecar.load(instanceDir),
            // Needs `context` for the sidecar getter; assigned after the literal.
            contextSelectorKeywords: undefined as unknown as KeywordIndex,
            // Replaced below; the queue's broadcaster needs `context` to be
            // available so it can route through `context.clientIO`.
            requestQueue: undefined as unknown as RequestQueue,
        };
        contextForCleanup = context;

        context.contextSelectorKeywords = new KeywordIndex(
            agentSchemaSource(agents),
            () => context.contextSelectorSidecar,
        );

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

        // Build the per-dispatcher AppAgentHost applicator.
        // Its apply closures reach the fully-built `context`.
        const hostApplyFns: AppAgentHostApplyFns = {
            applyAdd: (provider, notify) =>
                hostAddProvider(context, provider, notify),
            applyRemove: (provider, notify, dropConfig) =>
                hostRemoveProvider(context, provider, notify, dropConfig),
        };
        context.appAgentHost = new AppAgentHostApplicator(
            context.commandLock,
            hostApplyFns,
        );

        await addAppAgentProviders(context, options?.appAgentProviders);

        // Connect the injected dynamic agent sources. The
        // initial set comes from the vended `connection.providers` registered
        // through the normal path; subsequent add/remove deltas arrive via the
        // `AppAgentHost` fan-out.
        if (options?.appAgentSources) {
            for (const source of options.appAgentSources) {
                const connection = source.connect(context.appAgentHost);
                context.appAgentConnections.push(connection);
                // Register the vended providers under a SINGLE held command
                // lock, acquired synchronously in the same tick as the
                // `connect()` above. The applicator's fan-out add/remove legs
                // acquire the SAME command lock (FIFO), and the lock is free
                // here, so this section grabs it first and holds it across the
                // whole install. Any concurrent uninstall/update barrier that
                // targets this session therefore enqueues its op strictly AFTER
                // this section runs. That closes the connect-vs-drain race where
                // a sibling drain could remove an agent on this session before
                // its add had landed — leaking it here while it is gone
                // everywhere else.
                //
                // `connection.providers` is a single promise. When nothing is in
                // flight it resolves immediately with the active set (the source
                // joins this session to its fan-out registry in the same tick).
                // When this session connects while a name is mid-`removing`, the
                // source instead PARKS it OUT of the fan-out registry until every
                // in-flight barrier settles, then snapshots the now-quiet active
                // set (already reflecting each decided outcome) and joins. Either
                // way, awaiting it here — STILL holding the command lock, so no
                // user command can slip in — means the session never loads a
                // doomed version (verify-0 pollution) nor runs a command with an
                // agent mid-swap. The wait is bounded by the barriers' quiesce
                // timeout, and they decide independently of this session's
                // command lock, so holding it here cannot deadlock.
                // Uses `installAppProvider` directly (not the add-known-agents
                // path) so `reconcileKnownAgents` below still sees the true
                // persisted-vs-available diff.
                const { providers } = connection;
                await context.commandLock(async () => {
                    for (const provider of await providers) {
                        await installAppProvider(context, provider);
                    }
                });
            }
        }

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

        // Reconcile this session's known agent set against what is now available:
        // report agents that appeared/disappeared while it
        // was offline, and record the baseline for the next load.
        reconcileKnownAgents(context);
        debug("Context initialized");
        return context;
    } catch (e) {
        if (contextForCleanup !== undefined) {
            contextForCleanup.appAgentHost?.dispose();
            try {
                await contextForCleanup.requestQueue?.drainAndStop();
            } catch {
                // best-effort
            }
            try {
                await contextForCleanup.agents.close();
            } catch {
                // best-effort
            }
            for (const connection of contextForCleanup.appAgentConnections) {
                try {
                    connection.dispose();
                } catch (disposeError) {
                    debugError(
                        `Failed to dispose source connection after init failure: ${disposeError}`,
                    );
                }
            }
            contextForCleanup.appAgentConnections.length = 0;
        }
        if (instanceDirLock) {
            await instanceDirLock();
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
    // Stop accepting fan-out ops into this (closing) session: abandon queued
    // add/remove and make any later fan-out a no-op.
    context.appAgentHost.dispose();
    // Drain in-flight/queued entries before tearing down agents.
    try {
        await context.requestQueue.drainAndStop();
    } catch {
        // best-effort
    }
    // Save the session because the token count is in it.
    context.session.save();
    // Tear down every loaded agent, including those vended by the dynamic
    // sources: `close()` unloads each agent instance from its provider and drops
    // its session context. The shared provider instances themselves are NOT torn
    // down — other sessions still hold them.
    await context.agents.close();
    // Only after this session's agent instances are unloaded do we disconnect
    // from the dynamic sources: deregister this host from each source's client
    // registry so any in-flight barrier stops waiting on it.
    for (const connection of context.appAgentConnections) {
        try {
            connection.dispose();
        } catch (e) {
            debugError(`Failed to dispose source connection: ${e}`);
        }
    }
    context.appAgentConnections.length = 0;
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
    // Reconcile the newly-activated session's known agent set:
    // switching to a session that was created/last-saved against a
    // different available set reports the delta and re-baselines.
    reconcileKnownAgents(context);
    context.translatorCache.clear();
    // Session switch (§7.2): drop the contextSelector conversation buffer and
    // the derived-keyword cache (agents were closed/reloaded above).
    context.conversationSignal.reset();
    context.contextSelectorKeywords.invalidate();
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
