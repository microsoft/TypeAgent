// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getExplainerFactories } from "../explanation/explainerFactories.js";
import { GenericExplainer } from "../explanation/genericExplainer.js";
import { SchemaConfigProvider } from "../explanation/schemaConfig.js";
import { CacheOptions, AgentCache } from "./cache.js";
import { Logger } from "common-utils";

const defaultExplainerName = "v5";

export function getDefaultExplainerName() {
    return defaultExplainerName;
}

export type ExplainerFactory = (
    translatorName: string | undefined,
    model?: string,
) => GenericExplainer;

export type CustomExplainerFactory = (
    translatorName: string,
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
        translatorName: string,
        explainerName: string,
        model?: string,
    ) {
        return this.getExplainerFactory(explainerName)(translatorName, model);
    }

    public create(
        explainerName: string = getDefaultExplainerName(),
        getSchemaConfig?: SchemaConfigProvider,
        cacheOptions?: CacheOptions,
        logger?: Logger,
    ) {
        return new AgentCache(
            explainerName,
            this.getExplainerFactory(explainerName),
            getSchemaConfig,
            cacheOptions,
            logger,
        );
    }

    private getExplainerFactory(explainerName: string) {
        const existing = this.explainerFactories.get(explainerName);
        if (existing) {
            return existing;
        }

        const defaultFactory = getExplainerFactories()[explainerName];
        if (defaultFactory === undefined) {
            throw new Error(`Invalid explainer name '${explainerName}'`);
        }
        const customFactory = this.getCustomExplainerFactory?.(explainerName);
        const cache = new Map<string | undefined, GenericExplainer>();
        const factory = (translator: string | undefined, model?: string) => {
            const existing = cache.get(translator);
            if (existing) {
                return existing;
            }

            // Undefined translator is not overridable.
            const customExplainer = translator
                ? customFactory?.(translator)
                : undefined;

            if (customExplainer !== undefined && model !== undefined) {
                throw new Error("Custom model not supported");
            }

            const explainer = customExplainer ?? defaultFactory(model);
            cache.set(translator, explainer);
            return explainer;
        };

        this.explainerFactories.set(explainerName, factory);
        return factory;
    }
}
