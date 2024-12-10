// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getExplainerFactories } from "../explanation/explainerFactories.js";
import { GenericExplainer } from "../explanation/genericExplainer.js";
import { SchemaInfoProvider } from "../explanation/schemaInfoProvider.js";
import { CacheOptions, AgentCache } from "./cache.js";
import { Logger } from "telemetry";

const defaultExplainerName = "v5";

export function getDefaultExplainerName() {
    return defaultExplainerName;
}

export type ExplainerFactory = (
    schemaNames: string[] | undefined,
    model?: string,
) => GenericExplainer;

export type CustomExplainerFactory = (
    schemaNames: string[],
) => GenericExplainer | undefined;

export class AgentCacheFactory {
    private explainerFactories = new Map<string, ExplainerFactory>();
    constructor(
        private readonly getCustomExplainerFactory?: (
            explainerName: string,
        ) => CustomExplainerFactory,
    ) {}

    public getExplainerNames() {
        return Object.keys(getExplainerFactories());
    }

    public getExplainer(
        schemaNames: string[],
        explainerName: string,
        model?: string,
    ) {
        return this.getExplainerFactory(explainerName)(schemaNames, model);
    }

    public create(
        explainerName: string = getDefaultExplainerName(),
        schemaInfoProvider?: SchemaInfoProvider,
        cacheOptions?: CacheOptions,
        logger?: Logger,
    ) {
        return new AgentCache(
            explainerName,
            this.getExplainerFactory(explainerName),
            schemaInfoProvider,
            cacheOptions,
            logger,
        );
    }

    private getExplainerFactory(explainerName: string): ExplainerFactory {
        const existing = this.explainerFactories.get(explainerName);
        if (existing) {
            return existing;
        }

        const defaultFactory = getExplainerFactories()[explainerName];
        if (defaultFactory === undefined) {
            throw new Error(`Invalid explainer name '${explainerName}'`);
        }
        const customFactory = this.getCustomExplainerFactory?.(explainerName);
        const cache = new Map<string, GenericExplainer>();
        const defaultCache = new Map<string, GenericExplainer>();
        const getDefaultExplainer = (model?: string) => {
            const key = model ?? "";
            let explainer = defaultCache.get(key);
            if (explainer !== undefined) {
                return explainer;
            }
            explainer = defaultFactory(model);
            defaultCache.set(key, explainer);
            return explainer;
        };
        const factory = (schemaNames: string[] | undefined, model?: string) => {
            const key = `${schemaNames ? schemaNames.join("|") : ""}|${model ?? ""}`;
            const existing = cache.get(key);
            if (existing) {
                return existing;
            }

            // Undefined translator is not overridable.
            const customExplainer = schemaNames
                ? customFactory?.(schemaNames)
                : undefined;

            if (customExplainer !== undefined && model !== undefined) {
                throw new Error("Custom model not supported");
            }

            const explainer = customExplainer ?? getDefaultExplainer(model);
            cache.set(key, explainer);
            return explainer;
        };

        this.explainerFactories.set(explainerName, factory);
        return factory;
    }
}
