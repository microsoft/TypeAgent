// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SchemaConfigProvider } from "../explanation/schemaConfig.js";
import { Construction } from "./constructions.js";
import { Actions, RequestAction } from "../explanation/requestAction.js";
import {
    ConstructionFactory,
    GenericExplainer,
} from "../explanation/genericExplainer.js";
import { ExplanationData } from "../explanation/explanationData.js";
import chalk from "chalk";
import registerDebug from "debug";
import { ExplainerFactory } from "../cache/factory.js";
import { printTransformNamespaces } from "../utils/print.js";
import { ConstructionCache } from "./constructionCache.js";

const debugConstCreate = registerDebug("typeagent:const:create");
const debugConstMerge = registerDebug("typeagent:const:merge");

export type ImportConstructionResult = {
    existingCount: number;
    inputCount: number;
    newCount: number;
    addCount: number;
};

type ConstructionData = {
    translatorNames: string[];
    construction: Construction;
};

function createConstructions(
    data: ExplanationData,
    explainer: GenericExplainer,
    getSchemaConfig: SchemaConfigProvider | undefined,
    createConstruction: ConstructionFactory<any>,
) {
    const constructions: ConstructionData[] = [];
    for (const entry of data.entries) {
        const requestAction = new RequestAction(
            entry.request,
            Actions.fromJSON(entry.action),
        );

        try {
            const actions = requestAction.actions;

            const explanation = entry.explanation;
            const translatorNames = actions.translatorNames;
            const construction = createConstruction(
                requestAction,
                explanation,
                {
                    getSchemaConfig,
                },
            );

            if (debugConstCreate.enabled) {
                debugConstCreate("-".repeat(80));
                debugConstCreate(`Request Action: ${requestAction}`);
                debugConstCreate(`  Construction: ${chalk.cyan(construction)}`);
                debugConstCreate(
                    `   Explanation: ${chalk.greenBright(JSON.stringify(explanation))}`,
                );
                printTransformNamespaces(
                    construction.transformNamespaces,
                    debugConstCreate,
                    "  ",
                );
            }
            const matched = construction.match(entry.request, {
                enableWildcard: false,
                rejectReferences: false,
            });
            if (explainer.validate !== undefined) {
                const error = explainer.validate(requestAction, explanation);
                if (error !== undefined) {
                    throw new Error(
                        `${
                            matched === undefined ? "Unmatched" : "Matched"
                        } Explanation Validation failed: ${
                            Array.isArray(error)
                                ? `\n${error.join("\n")}`
                                : error
                        }`,
                    );
                }
            } else if (matched === undefined) {
                throw new Error(
                    `Missing explanation validation failure for unmatched construction.\n  Construction: ${construction}`,
                );
            }
            if (debugConstCreate.enabled) {
                debugConstCreate(`       Matched: ${chalk.green(matched)}`);
            }
            constructions.push({ translatorNames, construction });
        } catch (e: any) {
            console.error(
                chalk.red(`ERROR: ${e.message}\n  Input: ${requestAction}`),
            );
        }
    }
    return constructions;
}

export function importConstructions(
    explanationData: ExplanationData[],
    constructionStore: ConstructionCache,
    getExplainerForTranslator: ExplainerFactory,
    mergeMatchSets: boolean,
    cacheConflicts: boolean,
    getSchemaConfig?: SchemaConfigProvider,
): ImportConstructionResult {
    if (
        explanationData.some(
            (data) => data.explainerName !== constructionStore.explainerName,
        )
    ) {
        throw new Error(
            `Unable to import constructions from different explainer than the store`,
        );
    }
    // Convert all explanation data into constructions
    const constructionData: ConstructionData[] = [];
    const existingCount = constructionStore.count;
    let count = 0;
    let newCount = 0;
    for (const data of explanationData) {
        count += data.entries.length;
        const explainer = getExplainerForTranslator(data.translatorName);
        const createConstruction = explainer.createConstruction;
        if (createConstruction === undefined) {
            throw new Error(
                `Explainer ${constructionStore.explainerName} does not support construction creation.`,
            );
        }
        const constructions = createConstructions(
            data,
            explainer,
            getSchemaConfig,
            createConstruction,
        );
        newCount += constructions.length;
        constructionData.push(...constructions);
    }

    // Add the constructions to the store
    for (const { translatorNames, construction } of constructionData) {
        const result = constructionStore.addConstruction(
            translatorNames,
            construction,
            mergeMatchSets,
            cacheConflicts,
        );
        if (debugConstMerge.enabled) {
            const status = result.added
                ? `    ADDED: ${chalk.greenBright(construction)}`
                : `NOT ADDED: ${chalk.grey(construction)}`;
            const existing = result.existing.length
                ? `\n  ${
                      result.added
                          ? chalk.red(result.existing.join("\n  "))
                          : chalk.cyan(result.existing.join("\n  "))
                  }`
                : "";
            debugConstMerge(`${status}${existing}`);
        }
    }

    return {
        existingCount,
        inputCount: count,
        newCount,
        addCount: constructionStore.count - existingCount,
    };
}
