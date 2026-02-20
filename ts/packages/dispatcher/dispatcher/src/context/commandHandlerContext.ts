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
    currentScriptDir: string;
    logger?: Logger | undefined;
    currentRequestId: RequestId | undefined;
    commandResult?: CommandResult | undefined;
    chatHistory: ChatHistory;
    constructionProvider?: ConstructionProvider | undefined;

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
    actionResultKnowledgeExtraction: boolean;
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
 * - portBase: The base port to use for the agents. Default is 9001.   Agents will be assigned ports starting from this value.
 * - allowSharedLocalView: The list of agent names that can get the ports of all other agent's port. Default is undefined.
 *
 * Logging options:
 * - metrics: whether to enable collection of timing metrics. Default is false.
 * - collectCommandResult: whether to collect command result in the return for `processCommand`. Default is false.
 * - dblogging: whether to enable database logging. If not specified, no logging is done.
 * - traceId: An optional trace ID to use for logging identification.
 */
export type DispatcherOptions = DeepPartialUndefined<DispatcherConfig> & {
    // Core options
    appAgentProviders?: AppAgentProvider[];
    persistDir?: string | undefined; // the directory to save state.
    persistSession?: boolean; // default to false,
    storageProvider?: StorageProvider | undefined;

    clientIO?: ClientIO | undefined; // required for interactivity, undefined to disable any IO.

    // Initial state settings
    agents?: AppAgentStateInitSettings;

    // Agent port assignments
    allowSharedLocalView?: string[]; // agents that can access any shared local views, default to undefined
    portBase?: number; // default to 9001

    // Indexing service discovery
    indexingServiceRegistry?: IndexingServiceRegistry; // registry for indexing service discovery

    // Agent specific initialization options.
    agentInitOptions?: Record<string, unknown>; // agent specific initialization options.

    // Logging options
    metrics?: boolean; // default to false
    collectCommandResult?: boolean; // default to false
    dblogging?: boolean; // default to false
    traceId?: string; // optional additional for logging identification

    // Additional integration options
    agentInstaller?: AppAgentInstaller;
    constructionProvider?: ConstructionProvider;
    explanationAsynchronousMode?: boolean; // default to true

    // Use for tests so that embedding can be cached without 'persistDir'
    embeddingCacheDir?: string | undefined; // default to 'cache' under 'persistDir' if specified

    conversationMemorySettings?: {
        requestKnowledgeExtraction?: boolean;
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
            for (const provider of appAgentProviders) {
                await context.agents.addProvider(
                    provider,
                    context.agentCache.grammarStore,
                    embeddingCache,
                    context.agentGrammarRegistry,
                    useNFAGrammar,
                );
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
    const storageProvider = options?.storageProvider;
    if (persistDir === undefined) {
        if (persistSession) {
            throw new Error(
                "Persist session requires persistDir to be set in options.",
            );
        }
    } else {
        if (storageProvider === undefined) {
            throw new Error(
                "persistDir requires storageProvider to be set in options.",
            );
        }
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
            storageProvider,
            explanationAsynchronousMode,
            dblogging: options?.dblogging ?? false,
            clientIO,

            // Runtime context
            commandLock: createLimiter(1), // Make sure we process one command at a time.
            currentRequestId: undefined,
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
            actionResultKnowledgeExtraction:
                options?.conversationMemorySettings
                    ?.actionResultKnowledgeExtraction ?? true,
        };

        await initializeMemory(context, sessionDirPath);
        await addAppAgentProviders(context, options?.appAgentProviders);

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

            // Prefer explicit compiledSchemaFile field
            if (actionConfig.compiledSchemaFilePath) {
                return getPackageFilePath(actionConfig.compiledSchemaFilePath);
            }

            // Fallback: try to derive .pas.json path from .ts schemaFilePath
            if (
                actionConfig.schemaFilePath &&
                actionConfig.schemaFilePath.endsWith(".ts")
            ) {
                // Try common pattern: ./src/schema.ts -> ../dist/schema.pas.json
                const derivedPath = actionConfig.schemaFilePath
                    .replace(/^\.\/src\//, "../dist/")
                    .replace(/\.ts$/, ".pas.json");
                debug(
                    `Attempting fallback .pas.json path for ${schemaName}: ${derivedPath}`,
                );
                try {
                    return getPackageFilePath(derivedPath);
                } catch {
                    // Fallback path doesn't exist, continue to error
                }
            }

            throw new Error(
                `Compiled schema file path (.pas.json) not found for schema: ${schemaName}. ` +
                    `Please add 'compiledSchemaFile' field to the manifest pointing to the .pas.json file.`,
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
