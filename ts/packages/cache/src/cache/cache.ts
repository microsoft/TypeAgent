// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { DeepPartialUndefined } from "@typeagent/common-utils";

const debug = registerDebug("typeagent:cache");
import * as Telemetry from "telemetry";
import { ExplanationData } from "../explanation/explanationData.js";
import {
    equalNormalizedObject,
    getFullActionName,
    getTranslationNamesForActions,
    RequestAction,
} from "../explanation/requestAction.js";
import {
    SchemaInfoProvider,
    doCacheAction,
    isValidActionSchemaFileHash,
} from "../explanation/schemaInfoProvider.js";
import {
    ConstructionStore,
    ConstructionStoreImpl,
} from "./constructionStore.js";
import { ExplainerFactory } from "./factory.js";
import {
    CompletionResult,
    MatchOptions,
    mergeCompletionResults,
    NamespaceKeyFilter,
} from "../constructions/constructionCache.js";
import {
    ExplainWorkQueue,
    ExplanationOptions,
    ProcessExplanationResult,
} from "./explainWorkQueue.js";
import { GrammarStoreImpl } from "./grammarStore.js";
import { GrammarStore, MatchResult } from "./types.js";

export type ProcessRequestActionResult = {
    explanationResult: ProcessExplanationResult;
    constructionResult?: {
        added: boolean;
        message: string;
    };
    grammarResult?: {
        success: boolean;
        message: string;
        generatedRule?: string;
    };
};

export type CacheConfig = {
    mergeMatchSets: boolean;
    cacheConflicts: boolean;
};

export type CacheOptions = DeepPartialUndefined<CacheConfig>;

function getFailedResult(message: string): ProcessRequestActionResult {
    return {
        explanationResult: {
            explanation: {
                success: false,
                message,
            },
            elapsedMs: 0,
        },
    };
}

export function getSchemaNamespaceKey(
    name: string,
    activityName: string | undefined,
    schemaInfoProvider: SchemaInfoProvider | undefined,
) {
    return `${name},${schemaInfoProvider?.getActionSchemaFileHash(name) ?? ""},${activityName ?? ""}`;
}

// Namespace policy. Combines schema name, file hash, and activity name to indicate enabling/disabling of matching.
export function getSchemaNamespaceKeys(
    schemaNames: string[],
    activityName: string | undefined,
    schemaInfoProvider: SchemaInfoProvider | undefined,
) {
    // Current namespace keys policy is just combining schema name its file hash
    return schemaNames.map((name) =>
        getSchemaNamespaceKey(name, activityName, schemaInfoProvider),
    );
}

export function splitSchemaNamespaceKey(namespaceKey: string): {
    schemaName: string;
    hash: string | undefined;
    activityName: string | undefined;
} {
    const [schemaName, hash, activityName] = namespaceKey.split(",");
    return {
        schemaName,
        hash: hash !== "" ? hash : undefined,
        activityName: activityName !== "" ? activityName : undefined,
    };
}

export class AgentCache {
    private _constructionStore: ConstructionStoreImpl;
    private _grammarStore: GrammarStoreImpl;
    private readonly explainWorkQueue: ExplainWorkQueue;
    // Function to return whether the namespace key matches to the current schema file's hash.
    private readonly namespaceKeyFilter?: NamespaceKeyFilter;
    private readonly logger: Telemetry.Logger | undefined;
    public model?: string;
    constructor(
        public readonly explainerName: string,
        getExplainerForTranslator: ExplainerFactory,
        private readonly schemaInfoProvider?: SchemaInfoProvider,
        cacheOptions?: CacheOptions,
        logger?: Telemetry.Logger,
    ) {
        this._grammarStore = new GrammarStoreImpl(schemaInfoProvider);
        this._constructionStore = new ConstructionStoreImpl(
            explainerName,
            cacheOptions,
        );

        this.explainWorkQueue = new ExplainWorkQueue(getExplainerForTranslator);

        this.logger = logger
            ? new Telemetry.ChildLogger(logger, "cache", {
                  explainerName,
              })
            : undefined;

        if (schemaInfoProvider) {
            this.namespaceKeyFilter = (namespaceKey) => {
                const { schemaName, hash } =
                    splitSchemaNamespaceKey(namespaceKey);
                return isValidActionSchemaFileHash(
                    schemaInfoProvider,
                    schemaName,
                    hash,
                );
            };
        }
    }

    private _agentGrammarRegistry?: any; // AgentGrammarRegistry from action-grammar
    private _persistedGrammarStore?: any; // GrammarStore from action-grammar for persistence
    private _useNFAGrammar: boolean = false;
    private _getSchemaFilePath?: (schemaName: string) => string;

    /**
     * Configure grammar generation for the NFA/dynamic grammar system
     * Call this after the AgentGrammarRegistry is initialized
     */
    public configureGrammarGeneration(
        agentGrammarRegistry: any,
        persistedGrammarStore: any,
        useNFA: boolean,
        getSchemaFilePath?: (schemaName: string) => string,
    ): void {
        this._agentGrammarRegistry = agentGrammarRegistry;
        this._persistedGrammarStore = persistedGrammarStore;
        this._useNFAGrammar = useNFA;
        // Enable NFA matching in the grammar store
        this._grammarStore.setUseNFA(useNFA);
        debug(
            `Grammar system configured: ${useNFA ? "NFA" : "completion-based"}`,
        );
        if (getSchemaFilePath !== undefined) {
            this._getSchemaFilePath = getSchemaFilePath;
        }
    }

    /**
     * Sync a grammar from AgentGrammarRegistry to GrammarStoreImpl after dynamic rules are added
     * This ensures cache matching sees the updated combined grammar
     */
    public syncAgentGrammar(schemaName: string): void {
        if (!this._agentGrammarRegistry) {
            debug(`syncAgentGrammar: No registry for ${schemaName}`);
            return;
        }

        const agentGrammar = this._agentGrammarRegistry.getAgent(schemaName);
        if (!agentGrammar) {
            debug(`syncAgentGrammar: No agent grammar found for ${schemaName}`);
            return;
        }

        // Get the merged grammar (static + dynamic) from the registry
        const mergedGrammar = agentGrammar.getGrammar();
        debug(
            `syncAgentGrammar: Syncing ${schemaName}: ${mergedGrammar.rules.length} rule(s)`,
        );

        // Update the grammar store used for matching
        this._grammarStore.addGrammar(schemaName, mergedGrammar);
    }

    public get grammarStore(): GrammarStore {
        return this._grammarStore;
    }
    public get constructionStore(): ConstructionStore {
        return this._constructionStore;
    }

    public getNamespaceKeys(
        schemaNames: string[],
        namespaceSuffix: string | undefined,
    ) {
        return getSchemaNamespaceKeys(
            schemaNames,
            namespaceSuffix,
            this.schemaInfoProvider,
        );
    }

    public getInfo() {
        return this._constructionStore.getInfo(this.namespaceKeyFilter);
    }
    public async prune() {
        if (this.namespaceKeyFilter === undefined) {
            throw new Error("Cannon prune cache without schema info provider");
        }

        return this._constructionStore.prune(this.namespaceKeyFilter);
    }

    public async processRequestAction(
        requestAction: RequestAction,
        cache: boolean = true,
        options?: ExplanationOptions,
    ): Promise<ProcessRequestActionResult> {
        try {
            const executableActions = requestAction.actions;

            debug(
                `processRequestAction: "${requestAction.request}" for actions: ${executableActions.map((a) => `${a.action.schemaName}.${a.action.actionName}`).join(", ")}`,
            );

            if (cache) {
                for (const action of executableActions) {
                    const cacheAction = doCacheAction(
                        action,
                        this.schemaInfoProvider,
                    );

                    if (!cacheAction) {
                        return getFailedResult(
                            `Caching disabled in schema config for action '${getFullActionName(action)}'`,
                        );
                    }
                }
            }

            const namespaceKeys = this.getNamespaceKeys(
                getTranslationNamesForActions(executableActions),
                options?.namespaceSuffix,
            );

            debug(
                `processRequestAction: Checking cache for existing matches...`,
            );
            // Make sure that we don't already have match (but rejected because of options)
            const matchResult = this.match(requestAction.request, {
                rejectReferences: false,
                history: requestAction.history,
                namespaceKeys,
            });

            debug(
                `processRequestAction: Cache check found ${matchResult.length} match(es)`,
            );

            const actions = executableActions.map((e) => e.action);
            for (const match of matchResult) {
                if (
                    equalNormalizedObject(
                        match.match.actions.map((e) => e.action),
                        actions,
                    )
                ) {
                    return getFailedResult(
                        `Existing construction matches the request but rejected.`,
                    );
                }
            }

            // In NFA mode, skip construction creation in explainer
            const constructionCreationConfig =
                cache && !this._useNFAGrammar
                    ? {
                          schemaInfoProvider: this.schemaInfoProvider,
                      }
                    : undefined;
            const explanationResult = await this.explainWorkQueue.queueTask(
                requestAction,
                cache,
                options,
                constructionCreationConfig,
                this.model,
            );

            const { explanation, elapsedMs } = explanationResult;
            this.logger?.logEvent("explanation", {
                request: requestAction.request,
                actions: executableActions,
                history: requestAction.history,
                explanation,
                elapsedMs,
            });

            const store = this._constructionStore;
            // In NFA mode, skip construction generation - use grammar rules instead
            const generateConstruction =
                cache && store.isEnabled() && !this._useNFAGrammar;
            if (this._useNFAGrammar && cache) {
                debug(
                    `Construction generation skipped in NFA mode - using grammar rules instead`,
                );
            }
            let constructionResult:
                | { added: boolean; message: string }
                | undefined;
            if (generateConstruction && explanation.success) {
                const construction = explanation.construction;
                let added = false;
                let message: string;
                if (construction === undefined) {
                    message = `Explainer '${this.explainerName}' doesn't support constructions.`;
                } else {
                    const result = await store.addConstruction(
                        namespaceKeys,
                        construction,
                    );
                    if (result.added) {
                        added = true;
                        message = `Construction added: ${result.construction}`;
                    } else {
                        message = `Construction merged:\n  ${result.existing.join(
                            "  \n",
                        )}`;
                    }
                    const info = this.getInfo();
                    this.logger?.logEvent("construction", {
                        added,
                        message,
                        config: this._constructionStore.getConfig(),
                        count: info?.constructionCount,
                        filteredCount: info?.filteredConstructionCount,
                        builtInCount: info?.builtInConstructionCount,
                        filteredBuiltinCount:
                            info?.filteredBuiltInConstructionCount,
                    });
                }
                constructionResult = { added, message };
            }

            // Generate grammar rules if using NFA system and explanation succeeded
            let grammarResult:
                | { success: boolean; message: string; generatedRule?: string }
                | undefined = undefined;
            if (
                cache &&
                this._useNFAGrammar &&
                explanation.success &&
                executableActions.length === 1
            ) {
                try {
                    const execAction = executableActions[0];
                    const schemaName = execAction.action.schemaName;
                    const actionName = execAction.action.actionName;
                    const parameters = execAction.action.parameters ?? {};

                    debug(
                        `Grammar gen starting for ${schemaName}.${actionName}`,
                    );
                    debug(
                        `_getSchemaFilePath is ${this._getSchemaFilePath ? "configured" : "NOT configured"}`,
                    );

                    // Check if we have the required components
                    if (!this._getSchemaFilePath) {
                        debug(`Schema file path getter not configured`);
                        grammarResult = {
                            success: false,
                            message: "Schema file path getter not configured",
                        };
                    } else {
                        try {
                            // Get schema file path
                            debug(
                                `Calling getSchemaFilePath("${schemaName}")...`,
                            );
                            const schemaPath =
                                this._getSchemaFilePath(schemaName);
                            debug(`Schema path: ${schemaPath}`);

                            // Import populateCache dynamically to avoid circular dependencies
                            debug(`Importing populateCache...`);
                            const { populateCache } = await import(
                                "action-grammar/generation"
                            );
                            debug(`populateCache imported successfully`);

                            debug(
                                `Calling populateCache for request: "${requestAction.request}"`,
                            );
                            // Generate grammar rule
                            const genResult = await populateCache({
                                request: requestAction.request,
                                schemaName,
                                action: {
                                    actionName,
                                    parameters,
                                },
                                schemaPath,
                            });
                            if (genResult.success && genResult.generatedRule) {
                                debug(
                                    `Grammar rule generated for ${schemaName}.${actionName}: ${genResult.generatedRule}`,
                                );

                                // Add rule to persisted grammar store
                                await this._persistedGrammarStore.addRule({
                                    schemaName,
                                    grammarText: genResult.generatedRule,
                                });

                                // Add rule to agent grammar registry (in-memory)
                                const agentGrammar =
                                    this._agentGrammarRegistry.getAgent(
                                        schemaName,
                                    );
                                if (agentGrammar) {
                                    debug(
                                        `Adding rule to agent grammar registry...`,
                                    );
                                    const addResult =
                                        agentGrammar.addGeneratedRules(
                                            genResult.generatedRule,
                                            genResult.checkedVariables,
                                        );
                                    if (addResult.success) {
                                        // Sync to the grammar store used for matching
                                        this.syncAgentGrammar(schemaName);
                                        debug(
                                            `Grammar rule added for ${schemaName}.${actionName}`,
                                        );
                                        grammarResult = {
                                            success: true,
                                            message: `Grammar rule added for ${schemaName}.${actionName}`,
                                            generatedRule:
                                                genResult.generatedRule,
                                        };
                                    } else {
                                        debug(
                                            `Failed to add rule to registry: ${addResult.errors.join(", ")}`,
                                        );
                                        grammarResult = {
                                            success: false,
                                            message: `Failed to add rule to agent registry: ${addResult.errors.join(", ")}`,
                                            ...(genResult.generatedRule && {
                                                generatedRule:
                                                    genResult.generatedRule,
                                            }),
                                        };
                                    }
                                } else {
                                    debug(
                                        `Agent grammar not found for ${schemaName}`,
                                    );
                                    grammarResult = {
                                        success: false,
                                        message: `Agent grammar not found for ${schemaName}`,
                                        ...(genResult.generatedRule && {
                                            generatedRule:
                                                genResult.generatedRule,
                                        }),
                                    };
                                }
                            } else {
                                debug(
                                    `Grammar generation rejected: ${genResult.rejectionReason || "unknown reason"}`,
                                );
                                grammarResult = {
                                    success: false,
                                    message:
                                        genResult.rejectionReason ||
                                        "Grammar generation failed",
                                    ...(genResult.generatedRule && {
                                        generatedRule: genResult.generatedRule,
                                    }),
                                };
                            }

                            this.logger?.logEvent("grammarGeneration", {
                                request: requestAction.request,
                                schemaName,
                                actionName,
                                success: grammarResult?.success,
                                message: grammarResult?.message,
                            });
                        } catch (genError) {
                            debug(`Error during generation: %O`, genError);
                            grammarResult = {
                                success: false,
                                message: `Generation error: ${genError instanceof Error ? genError.message : String(genError)}`,
                            };
                        }
                    }
                } catch (error: any) {
                    debug(`Unexpected error: %O`, error);
                    grammarResult = {
                        success: false,
                        message: `Grammar generation error: ${error.message}`,
                    };

                    this.logger?.logEvent("grammarGeneration", {
                        request: requestAction.request,
                        success: false,
                        error: error.message,
                    });
                }
            }

            if (grammarResult && !grammarResult.success) {
                debug(
                    `Rule generation failed: ${grammarResult.message}${grammarResult.generatedRule ? `, rule=${grammarResult.generatedRule}` : ""}`,
                );
            }

            return {
                explanationResult,
                ...(constructionResult !== undefined && { constructionResult }),
                ...(grammarResult !== undefined && { grammarResult }),
            };
        } catch (e: any) {
            this.logger?.logEvent("error", {
                request: requestAction.request,
                actions: requestAction.actions,
                history: requestAction.history,
                cache,
                options,
                message: e.message,
                stack: e.stack,
            });
            throw e;
        }
    }

    public async import(
        data: ExplanationData[],
        ignoreSourceHash: boolean = false,
    ) {
        return this._constructionStore.import(
            data,
            this.explainWorkQueue.getExplainerForTranslator,
            this.schemaInfoProvider,
            ignoreSourceHash,
        );
    }

    public isEnabled(): boolean {
        return (
            this._grammarStore.isEnabled() ||
            this._constructionStore.isEnabled()
        );
    }

    public isUsingNFAGrammar(): boolean {
        return this._useNFAGrammar;
    }

    public match(request: string, options?: MatchOptions): MatchResult[] {
        // If NFA grammar system is configured, only use grammar store
        if (this._useNFAGrammar) {
            debug(`match: Using NFA grammar store`);
            const grammarStore = this._grammarStore;
            if (grammarStore.isEnabled()) {
                return this._grammarStore.match(request, options);
            }
            throw new Error("Grammar store is disabled");
        }

        // Otherwise use completion-based construction store
        debug(`match: Using completion-based construction store`);
        const store = this._constructionStore;
        if (store.isEnabled()) {
            const constructionMatches = store.match(request, options);
            if (constructionMatches.length > 0) {
                // TODO: Move this in the construction store
                return constructionMatches.map((m) => {
                    const { construction, ...rest } = m;
                    return rest;
                });
            }
        }

        // Fallback to grammar store if construction store has no matches
        const grammarStore = this._grammarStore;
        if (grammarStore.isEnabled()) {
            return this._grammarStore.match(request, options);
        }
        throw new Error("AgentCache is disabled");
    }

    public completion(
        requestPrefix: string | undefined,
        options?: MatchOptions,
    ): CompletionResult | undefined {
        // If NFA grammar system is configured, only use grammar store
        if (this._useNFAGrammar) {
            const grammarStore = this._grammarStore;
            return grammarStore.completion(requestPrefix, options);
        }

        // Otherwise use completion-based construction store (with grammar store fallback)
        const store = this._constructionStore;
        const storeCompletion = store.completion(requestPrefix, options);
        const grammarStore = this._grammarStore;
        const grammarCompletion = grammarStore.completion(
            requestPrefix,
            options,
        );
        return mergeCompletionResults(storeCompletion, grammarCompletion);
    }
}
