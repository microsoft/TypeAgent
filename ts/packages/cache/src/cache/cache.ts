// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DeepPartialUndefined } from "common-utils";
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
    MatchOptions,
    NamespaceKeyFilter,
} from "../constructions/constructionCache.js";
import {
    ExplainWorkQueue,
    ExplanationOptions,
    ProcessExplanationResult,
} from "./explainWorkQueue.js";
import { GrammarStoreImpl } from "../grammar/grammarStore.js";
import { GrammarStore, MatchResult } from "./types.js";

export type ProcessRequestActionResult = {
    explanationResult: ProcessExplanationResult;
    constructionResult?: {
        added: boolean;
        message: string;
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
// Namespace policy. Combines schema name, file hash, and activity name to indicate enabling/disabling of matching.
export function getSchemaNamespaceKeys(
    schemaNames: string[],
    activityName: string | undefined,
    schemaInfoProvider: SchemaInfoProvider | undefined,
) {
    // Current namespace keys policy is just combining schema name its file hash
    return schemaNames.map(
        (name) =>
            `${name},${schemaInfoProvider?.getActionSchemaFileHash(name) ?? ""},${activityName ?? ""}`,
    );
}

function splitSchemaNamespaceKey(namespaceKey: string): {
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
        this._grammarStore = new GrammarStoreImpl();
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

            // Make sure that we don't already have match (but rejected because of options)
            const matchResult = this.match(requestAction.request, {
                rejectReferences: false,
                history: requestAction.history,
                namespaceKeys,
            });

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

            const constructionCreationConfig = cache
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
            const generateConstruction = cache && store.isEnabled();
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
                return {
                    explanationResult,
                    constructionResult: {
                        added,
                        message,
                    },
                };
            }

            return {
                explanationResult,
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

    public match(request: string, options?: MatchOptions): MatchResult[] {
        const allMatches: MatchResult[] = [];
        allMatches.push(...this._grammarStore.match(request, options));
        const store = this._constructionStore;
        if (store.isEnabled()) {
            allMatches.push(...store.match(request, options));
        }
        return allMatches.sort((a, b) => {
            // REVIEW: temporary heuristics to get better result with wildcards

            // Prefer non-wildcard matches
            if (a.wildcardCharCount === 0) {
                if (b.wildcardCharCount !== 0) {
                    return -1;
                }
            } else {
                if (b.wildcardCharCount === 0) {
                    return 1;
                }
            }

            // Prefer less implicit parameters
            if (a.implicitParameterCount !== b.implicitParameterCount) {
                return a.implicitParameterCount - b.implicitParameterCount;
            }

            // Prefer more non-optional parts
            if (b.nonOptionalCount !== a.nonOptionalCount) {
                return b.nonOptionalCount - a.nonOptionalCount;
            }

            // Prefer more matched parts
            if (b.matchedCount !== a.matchedCount) {
                return b.matchedCount - a.matchedCount;
            }

            // Prefer less wildcard characters
            return a.wildcardCharCount - b.wildcardCharCount;
        });
    }
}
