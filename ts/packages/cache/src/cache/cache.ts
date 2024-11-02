// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { QueueObject, queue } from "async";
import { ChildLogger, Logger, DeepPartialUndefined } from "common-utils";
import { ExplanationData } from "../explanation/explanationData.js";
import { Actions, RequestAction } from "../explanation/requestAction.js";
import {
    SchemaConfigProvider,
    doCacheAction,
} from "../explanation/schemaConfig.js";
import { GenericExplanationResult } from "../index.js";
import { ConstructionStore, ConstructionStoreImpl } from "./store.js";
import { ExplainerFactory } from "./factory.js";
import { explainMultipleActions } from "../explanation/v5/multiRequestExplanationV5.js";

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

type ExplanationOptions = {
    concurrent?: boolean; // whether to limit to run one at a time, require cache to be false
    rejectReferences?: boolean;
    checkExplainable?:
        | ((requestAction: RequestAction) => Promise<void>)
        | undefined; // throw exception if not explainable
};

export class AgentCache {
    private _constructionStore: ConstructionStoreImpl;
    private queue: QueueObject<{
        task: () => Promise<ProcessRequestActionResult>;
        resolve: (value: ProcessRequestActionResult) => void;
        reject: (reason?: any) => void;
    }>;

    private readonly logger: Logger | undefined;
    public model?: string;
    constructor(
        public readonly explainerName: string,
        private readonly getExplainerForTranslator: ExplainerFactory,
        private readonly getSchemaConfig?: SchemaConfigProvider,
        cacheOptions?: CacheOptions,
        logger?: Logger,
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
            ? new ChildLogger(logger, "cache", {
                  explainerName,
              })
            : undefined;
    }

    public get constructionStore(): ConstructionStore {
        return this._constructionStore;
    }

    private async processMultipleAction(
        requestAction: RequestAction,
        cache: boolean,
    ): Promise<ProcessRequestActionResult> {
        const startTime = performance.now();
        const explanation = await explainMultipleActions(
            requestAction,
            async (subRequestAction) => {
                return this.queueTask(subRequestAction, cache);
            },
        );
        return {
            explanationResult: {
                explanation,
                elapsedMs: performance.now() - startTime,
            },
        };
    }

    private getExplainerForActions(actions: Actions) {
        return this.getExplainerForTranslator(
            actions.action?.translatorName,
            this.model,
        );
    }

    private async queueTask(
        requestAction: RequestAction,
        cache: boolean,
        options?: ExplanationOptions,
    ): Promise<ProcessRequestActionResult> {
        const concurrent = options?.concurrent ?? false;
        const rejectReferences = options?.rejectReferences ?? true;
        const checkExplainable = options?.checkExplainable;
        const actions = requestAction.actions;
        for (const action of actions) {
            const translatorName = action.translatorName;
            const translatorSchemaConfig = translatorName
                ? this.getSchemaConfig?.(translatorName)
                : undefined;
            const cacheAction = doCacheAction(
                translatorSchemaConfig,
                action.actionName,
            );

            if (!cacheAction) {
                return getFailedResult(
                    `Caching disabled in schema config for action '${action.fullActionName}'`,
                );
            }
        }

        const task = async () => {
            const store = this._constructionStore;
            const generateConstruction = cache && store.isEnabled();
            const startTime = performance.now();
            const actions = requestAction.actions;
            const explainer = this.getExplainerForActions(actions);
            const constructionCreationConfig = {
                getSchemaConfig: this.getSchemaConfig,
            };

            const explainerConfig = {
                rejectReferences,
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
                    const result = await store.addConstruction(
                        actions.translatorNames,
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
                    this.logger?.logEvent("construction", {
                        added,
                        message,
                        config: this._constructionStore.getConfig(),
                        count: this._constructionStore.getInfo()
                            ?.constructionCount,
                        builtInCount:
                            this._constructionStore.getInfo()
                                ?.builtInConstructionCount,
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
                concurrent: options?.concurrent,
                rejectReferences: options?.rejectReferences,
                message: e.message,
                stack: e.stack,
            });
            throw e;
        }
    }

    public async correctExplanation(
        requestAction: RequestAction,
        explanation: object,
        correction: string,
    ): Promise<ProcessExplanationResult> {
        const startTime = performance.now();
        const actions = requestAction.actions;
        const explainer = this.getExplainerForActions(actions);

        if (!explainer.correct) {
            throw new Error("Explainer doesn't support correction");
        }
        const result = await explainer.correct(
            requestAction,
            explanation,
            correction,
        );

        return {
            explanation: result,
            elapsedMs: performance.now() - startTime,
            toPrettyString: explainer.toPrettyString,
        };
    }

    public async import(data: ExplanationData[]) {
        return this._constructionStore.import(
            data,
            this.getExplainerForTranslator,
            this.getSchemaConfig,
        );
    }
}
