// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SchemaInfoProvider } from "../explanation/schemaInfoProvider.js";
import { Construction } from "./constructions.js";
import {
    fromJsonActions,
    getTranslationNamesForActions,
    RequestAction,
} from "../explanation/requestAction.js";
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
import { getSchemaNamespaceKeys } from "../cache/cache.js";

const debugConstCreate = registerDebug("typeagent:const:create");
const debugConstMerge = registerDebug("typeagent:const:merge");

export type ImportConstructionResult = {
    existingCount: number;
    inputCount: number;
    newCount: number;
    addCount: number;
};

type ConstructionData = {
    namespaceKeys: string[];
    construction: Construction;
};

function createConstructions(
    data: ExplanationData,
    explainer: GenericExplainer,
    schemaInfoProvider: SchemaInfoProvider | undefined,
    createConstruction: ConstructionFactory<any>,
    ignoreSourceHash: boolean,
) {
    if (schemaInfoProvider !== undefined) {
        for (let i = 0; i < data.schemaNames.length; i++) {
            const schemaName = data.schemaNames[i];
            const sourceHash = data.sourceHashes[i];
            if (
                schemaInfoProvider.getActionSchemaFileHash(schemaName) !==
                sourceHash
            ) {
                const fileName = data.fileName ? ` in ${data.fileName}` : "";
                const message = `Schema hash mismatch for '${schemaName}'${fileName}`;
                if (ignoreSourceHash) {
                    console.warn(`WARNING: ${message}`);
                } else {
                    throw new Error(message);
                }
            }
        }
    }

    const dataSchemaNames = new Set(data.schemaNames);
    const constructions: ConstructionData[] = [];
    for (const entry of data.entries) {
        const requestAction = new RequestAction(
            entry.request,
            fromJsonActions(entry.action),
        );

        try {
            const actions = requestAction.actions;
            for (const { action } of actions) {
                if (!dataSchemaNames.has(action.schemaName)) {
                    throw new Error(
                        `Schema name '${action.schemaName}' not found in data header`,
                    );
                }
            }
            const explanation = entry.explanation;
            const namespaceKeys = getSchemaNamespaceKeys(
                getTranslationNamesForActions(actions),
                schemaInfoProvider,
            );
            const construction = createConstruction(
                requestAction,
                explanation,
                {
                    schemaInfoProvider: schemaInfoProvider,
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
            constructions.push({ namespaceKeys, construction });
        } catch (e: any) {
            const lines = [`ERROR: ${e.message}`];
            if (data.fileName !== undefined) {
                lines.push(`  File: ${data.fileName}`);
            }
            lines.push(`  Input: ${requestAction}`);
            console.error(chalk.red(lines.join("\n")));
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
    schemaInfoProvider?: SchemaInfoProvider,
    ignoreSourceHash: boolean = false,
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
        const explainer = getExplainerForTranslator(data.schemaNames);
        const createConstruction = explainer.createConstruction;
        if (createConstruction === undefined) {
            const fileName =
                data.fileName !== undefined ? `in file ${data.fileName}` : "";
            throw new Error(
                `Explainer ${constructionStore.explainerName} does not support construction creation with schema ${data.schemaNames.join(",")}${fileName}.`,
            );
        }
        const constructions = createConstructions(
            data,
            explainer,
            schemaInfoProvider,
            createConstruction,
            ignoreSourceHash,
        );
        newCount += constructions.length;
        constructionData.push(...constructions);
    }

    // Add the constructions to the store
    for (const { namespaceKeys, construction } of constructionData) {
        const result = constructionStore.addConstruction(
            namespaceKeys,
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
