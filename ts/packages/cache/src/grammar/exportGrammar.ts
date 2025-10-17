// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Expr,
    Rule,
    RuleDefinition,
    writeGrammarRules,
    ValueNode,
} from "action-grammar/rules";
import {
    Construction,
    getDefaultMatchValueTranslator,
    WildcardMode,
} from "../constructions/constructions.js";
import {
    getPropertyNameFromTransformInfo,
    isMatchPart,
    MatchSet,
    TransformInfo,
} from "../constructions/matchPart.js";
import { loadConstructionCacheFile } from "../cache/constructionStore.js";
import { setObjectProperty } from "common-utils";
import { MatchedValueTranslator } from "../constructions/constructionValue.js";

import registerDebug from "debug";

const debugError = registerDebug("typeagent:cache:grammar:export:error");
type State = {
    definitions: Set<RuleDefinition>;
    matchSetRuleDefinitions: Map<MatchSet, RuleDefinition>;
    ruleNameNextIds: Map<string, number>;
};
export async function convertConstructionFileToGrammar(fileName: string) {
    const cache = await loadConstructionCacheFile(fileName);
    if (cache === undefined) {
        throw new Error(`Construction cache file '${fileName}' is empty.`);
    }

    const state: State = {
        definitions: new Set(),
        matchSetRuleDefinitions: new Map(),
        ruleNameNextIds: new Map(),
    };
    const namespaces = cache.getConstructionNamespaces();
    for (const ns of namespaces) {
        const constructions = cache.getConstructionNamespace(ns);
        if (constructions === undefined) {
            throw new Error(
                `No constructions found for namespace '${ns}' in file '${fileName}'.`,
            );
        }
        convertConstructions(state, constructions.constructions);
    }
    return writeGrammarRules(Array.from(state.definitions));
}

export function convertConstructionsToGrammar(constructions: Construction[]) {
    const state: State = {
        definitions: new Set(),
        matchSetRuleDefinitions: new Map(),
        ruleNameNextIds: new Map(),
    };
    convertConstructions(state, constructions);
    return writeGrammarRules(Array.from(state.definitions));
}

function convertConstructions(state: State, constructions: Construction[]) {
    for (const construction of constructions) {
        convertConstruction(state, construction);
    }
}

function getNextRuleName(state: State, name: string): string {
    if (!/^\p{ID_Start}/u.test(name)) {
        name = `_${name}`;
    }
    const baseName = name.replaceAll(/[^\p{ID_Continue}]/gu, "_");
    const nextId = state.ruleNameNextIds.get(baseName) ?? 1;
    state.ruleNameNextIds.set(baseName, nextId + 1);
    return `${baseName}_${nextId}`;
}

function getMatchSetRuleDefinition(
    state: State,
    matchSet: MatchSet,
    translator: MatchedValueTranslator,
    transformInfo?: TransformInfo,
): RuleDefinition | undefined {
    if (transformInfo !== undefined) {
        // Can only reuse match set rules if there are no transforms
        const existing = state.matchSetRuleDefinitions.get(matchSet);
        if (existing !== undefined) {
            return existing;
        }
    }

    const rules: Rule[] = [];
    for (const match of matchSet.matches) {
        let value: ValueNode | undefined;
        if (transformInfo !== undefined) {
            const v = translator.transform(transformInfo, [match]);
            if (v === undefined) {
                // Transform failed, so skip this match.
                debugError("Skipping match with failed transform");
                return undefined;
            }
            value = {
                type: "literal",
                value: v,
            };
        }

        rules.push({
            expressions: [{ type: "string", value: match.split(" ") }],
            value,
        });
    }

    const matchSetRuleDefinition = {
        name: getNextRuleName(state, matchSet.name),
        rules,
    };
    state.matchSetRuleDefinitions.set(matchSet, matchSetRuleDefinition);

    return matchSetRuleDefinition;
}

function convertConstruction(
    state: State,
    construction: Construction,
): undefined {
    const expressions: Expr[] = [];
    let nextVariableId = 0;
    const propertyVariables = new Map<string, number>();
    const translator = getDefaultMatchValueTranslator(
        construction.transformNamespaces,
    );
    const matchSetRuleDefinitions: RuleDefinition[] = [];
    for (const part of construction.parts) {
        if (!isMatchPart(part)) {
            debugError("Skipping non-match part in exportGrammar");
            return undefined;
        }

        const transformInfos = part.transformInfos;
        let variableName: string | undefined;
        let transformInfo: TransformInfo | undefined;
        if (transformInfos !== undefined) {
            if (transformInfos.length !== 1) {
                debugError(
                    "Skipping multi-transform match part in exportGrammar",
                );
                return undefined;
            }
            transformInfo = transformInfos[0];
            if (transformInfo.partCount !== 1) {
                debugError(
                    "Skipping multi-part transform match part in exportGrammar",
                );
                return undefined;
            }
            const propertyName =
                getPropertyNameFromTransformInfo(transformInfo);
            const variableId = nextVariableId++;
            propertyVariables.set(propertyName, variableId);
            variableName = `v${variableId}`;
        }
        const matchSet = part.matchSet;
        if (matchSet) {
            const ruleDef = getMatchSetRuleDefinition(
                state,
                matchSet,
                translator,
                transformInfo,
            );

            if (ruleDef === undefined) {
                // Skip
                continue;
            }
            matchSetRuleDefinitions.push(ruleDef);
            if (variableName !== undefined) {
                if (part.optional) {
                    throw new Error(
                        "Internal error: Captured parts cannot be optional",
                    );
                }
                expressions.push({
                    type: "variable",
                    name: variableName,
                    typeName: ruleDef.name,
                    ruleReference: true,
                });
            } else {
                const expr: Expr = {
                    type: "ruleReference",
                    name: ruleDef.name,
                };
                if (part.optional) {
                    expressions.push({
                        type: "rules",
                        rules: [{ expressions: [expr] }],
                        optional: true,
                    });
                } else {
                    expressions.push(expr);
                }
            }
        } else {
            // Wildcard
            if (part.wildcardMode === WildcardMode.Disabled) {
                throw new Error(
                    "Internal error: Match part must be wildcard if no match set",
                );
            }
            if (variableName === undefined) {
                throw new Error(
                    "Internal error: Wildcard part must be captured",
                );
            }
            expressions.push({
                type: "variable",
                name: variableName,
                typeName: "string",
                ruleReference: false,
            });
        }
    }

    // Now add all the needed definitions
    state.definitions.add({
        name: "Start",
        rules: [
            {
                expressions,
                value: createValueNode(construction, propertyVariables),
            },
        ],
    });
    for (const matchSetRuleDefinition of matchSetRuleDefinitions) {
        state.definitions.add(matchSetRuleDefinition);
    }
}

function createValueNode(
    construction: Construction,
    propertyVariables: Map<string, number>,
) {
    // Staging object to create the object/array structure.
    const valueRef: any = {};

    // The leaf values
    const leafValues: ValueNode[] = [];

    function setLeafValue(propertyName: string, value: ValueNode) {
        const index = leafValues.length;
        leafValues.push(value);
        setObjectProperty(valueRef, "value", propertyName, index);
    }

    for (const [propertyName, variableId] of propertyVariables) {
        setLeafValue(propertyName, {
            type: "variable",
            name: `v${variableId}`,
        });
    }

    if (construction.implicitActionName !== undefined) {
        setLeafValue("fullActionName", {
            type: "literal",
            value: construction.implicitActionName,
        });
    }
    const implicitParameters = construction.implicitParameters;
    if (implicitParameters !== undefined) {
        for (const { paramName, paramValue } of implicitParameters) {
            setLeafValue(paramName, {
                type: "literal",
                value: paramValue,
            });
        }
    }

    const emptyArrayParameters = construction.emptyArrayParameters;
    if (emptyArrayParameters !== undefined) {
        for (const paramName of emptyArrayParameters) {
            setLeafValue(paramName, {
                type: "array",
                value: [],
            });
        }
    }

    if (leafValues.length === 0) {
        throw new Error("Construction must always have value");
    }

    // Convert the staging object to a ValueNode
    return convertToValueNode(valueRef.value, leafValues);
}

function convertToValueNode(entry: any, leafValues: ValueNode[]): ValueNode {
    if (typeof entry === "number") {
        return leafValues[entry];
    }
    if (Array.isArray(entry)) {
        return {
            type: "array",
            value: entry.map((entry) => convertToValueNode(entry, leafValues)),
        };
    }
    if (typeof entry === "object" && entry !== null) {
        return {
            type: "object",
            value: Object.fromEntries(
                Object.entries(entry).map(([k, v]) => [
                    k,
                    convertToValueNode(v, leafValues),
                ]),
            ),
        };
    }
    throw new Error(`Internal error: invalid value node entry: ${entry}`);
}
