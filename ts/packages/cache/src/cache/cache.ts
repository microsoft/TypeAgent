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
} from "../explanation/schemaInfoProvider.js";
import { ConstructionStore, ConstructionStoreImpl } from "./store.js";
import { ExplainerFactory } from "./factory.js";
import { NamespaceKeyFilter } from "../constructions/constructionCache.js";
import {
    ExplainWorkQueue,
    ExplanationOptions,
    ProcessExplanationResult,
} from "./explainWorkQueue.js";

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

// Construction namespace policy
export function getSchemaNamespaceKeys(
    schemaNames: string[],
    schemaInfoProvider?: SchemaInfoProvider,
) {
    // Current namespace keys policy is just combining schema name its file hash
    return schemaInfoProvider
        ? schemaNames.map(
              (name) =>
                  `${name},${schemaInfoProvider.getActionSchemaFileHash(name)}`,
          )
        : schemaNames;
}

export class AgentCache {
    private _constructionStore: ConstructionStoreImpl;
    private readonly explainWorkQueue: ExplainWorkQueue;
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
                const [schemaName, hash] = namespaceKey.split(",");
                return (
                    schemaInfoProvider.getActionSchemaFileHash(schemaName) ===
                    hash
                );
            };
        }
    }

    public get constructionStore(): ConstructionStore {
        return this._constructionStore;
    }

    public getNamespaceKeys(schemaNames: string[]) {
        return getSchemaNamespaceKeys(schemaNames, this.schemaInfoProvider);
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

            const store = this._constructionStore;
            const namespaceKeys = this.getNamespaceKeys(
                getTranslationNamesForActions(executableActions),
            );
            // Make sure that we don't already have a construction that will match (but reject because of options)
            const matchResult = store.match(requestAction.request, {
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
}
