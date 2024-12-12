// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { QueueObject, queue } from "async";
import { DeepPartialUndefined } from "common-utils";
import * as Telemetry from "telemetry";
import { ExplanationData } from "../explanation/explanationData.js";
import {
    Actions,
    normalizeParamString,
    RequestAction,
} from "../explanation/requestAction.js";
import {
    SchemaInfoProvider,
    doCacheAction,
} from "../explanation/schemaInfoProvider.js";
import { GenericExplanationResult } from "../index.js";
import { ConstructionStore, ConstructionStoreImpl } from "./store.js";
import { ExplainerFactory } from "./factory.js";
import { getLanguageTools } from "../utils/language.js";
import { NamespaceKeyFilter } from "../constructions/constructionCache.js";

export type ProcessExplanationResult = {
    explanation: GenericExplanationResult;
    elapsedMs: number;
    toPrettyString?: ((explanation: object) => string) | undefined;
};

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

export type ExplanationOptions = {
    concurrent?: boolean; // whether to limit to run one at a time, require cache to be false
    valueInRequest?: boolean;
    noReferences?: boolean;
    checkExplainable?:
        | ((requestAction: RequestAction) => Promise<void>)
        | undefined; // throw exception if not explainable
};

const langTool = getLanguageTools("en");

function checkExplainableValues(
    requestAction: RequestAction,
    valueInRequest: boolean,
    noReferences: boolean,
) {
    // Do a cheap parameter check first.
    const normalizedRequest = normalizeParamString(requestAction.request);
    const pending: unknown[] = [];

    for (const action of requestAction.actions) {
        pending.push(action.parameters);
    }

    while (pending.length > 0) {
        const value = pending.pop();
        if (!value) {
            continue;
        }

        // TODO: check number too.
        if (typeof value === "string") {
            if (noReferences && langTool?.possibleReferentialPhrase(value)) {
                throw new Error(
                    "Request contains a possible referential phrase used for property values.",
                );
            }
            if (
                valueInRequest &&
                !normalizedRequest.includes(normalizeParamString(value))
            ) {
                throw new Error(
                    `Action parameter value '${value}' not found in the request`,
                );
            }
            continue;
        }
        if (typeof value === "object") {
            if (Array.isArray(value)) {
                pending.push(...value);
            } else {
                pending.push(...Object.values(value));
            }
        }
    }
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
    private queue: QueueObject<{
        task: () => Promise<ProcessRequestActionResult>;
        resolve: (value: ProcessRequestActionResult) => void;
        reject: (reason?: any) => void;
    }>;

    private readonly namespaceKeyFilter?: NamespaceKeyFilter;
    private readonly logger: Telemetry.Logger | undefined;
    public model?: string;
    constructor(
        public readonly explainerName: string,
        private readonly getExplainerForTranslator: ExplainerFactory,
        private readonly schemaInfoProvider?: SchemaInfoProvider,
        cacheOptions?: CacheOptions,
        logger?: Telemetry.Logger,
    ) {
        this._constructionStore = new ConstructionStoreImpl(
            explainerName,
            cacheOptions,
        );

        this.queue = queue(async (item, callback) => {
            try {
                item.resolve(await item.task());
            } catch (e: any) {
                item.reject(e);
            }
        });

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
    private getExplainerForActions(actions: Actions) {
        return this.getExplainerForTranslator(
            actions.translatorNames,
            this.model,
        );
    }

    private async queueTask(
        requestAction: RequestAction,
        cache: boolean,
        options?: ExplanationOptions,
    ): Promise<ProcessRequestActionResult> {
        const concurrent = options?.concurrent ?? false;
        const valueInRequest = options?.valueInRequest ?? true;
        const noReferences = options?.noReferences ?? true;
        const checkExplainable = options?.checkExplainable;
        const actions = requestAction.actions;
        for (const action of actions) {
            const cacheAction = doCacheAction(action, this.schemaInfoProvider);

            if (!cacheAction) {
                return getFailedResult(
                    `Caching disabled in schema config for action '${action.fullActionName}'`,
                );
            }
        }

        checkExplainableValues(requestAction, valueInRequest, noReferences);

        const task = async () => {
            const store = this._constructionStore;
            const generateConstruction = cache && store.isEnabled();
            const startTime = performance.now();
            const actions = requestAction.actions;
            const explainer = this.getExplainerForActions(actions);
            const constructionCreationConfig = {
                schemaInfoProvider: this.schemaInfoProvider,
            };

            const explainerConfig = {
                constructionCreationConfig,
            };

            await checkExplainable?.(requestAction);
            const explanation = await explainer.generate(
                requestAction,
                explainerConfig,
            );
            const elapsedMs = performance.now() - startTime;

            this.logger?.logEvent("explanation", {
                request: requestAction.request,
                actions,
                history: requestAction.history,
                explanation,
                elapsedMs,
            });

            const explanationResult = {
                explanation,
                elapsedMs,
                toPrettyString: explainer.toPrettyString,
            };
            if (generateConstruction && explanation.success) {
                const construction = explanation.construction;
                let added = false;
                let message: string;
                if (construction === undefined) {
                    message = `Explainer '${this.explainerName}' doesn't support constructions.`;
                } else {
                    const namespaceKeys = this.getNamespaceKeys(
                        actions.translatorNames,
                    );
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
        };

        if (concurrent && !cache) {
            return task();
        }
        return new Promise((resolve, reject) => {
            this.queue.push({
                task,
                resolve,
                reject,
            });
        });
    }

    public async processRequestAction(
        requestAction: RequestAction,
        cache: boolean = true,
        options?: ExplanationOptions,
    ): Promise<ProcessRequestActionResult> {
        try {
            return await this.queueTask(requestAction, cache, options);
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
            this.getExplainerForTranslator,
            this.schemaInfoProvider,
            ignoreSourceHash,
        );
    }
}
