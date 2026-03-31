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
import { isParsePart, ParsePart } from "../constructions/parsePart.js";
import { loadConstructionCacheFile } from "../cache/constructionStore.js";
import { setObjectProperty } from "@typeagent/common-utils";
import { MatchedValueTranslator } from "../constructions/constructionValue.js";

import registerDebug from "debug";

const debugError = registerDebug("typeagent:cache:grammar:export:error");
const MAX_MULTI_PART_COMBINATIONS = 1000;
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
    return writeGrammarRules({
        definitions: Array.from(state.definitions),
        imports: [],
    });
}

export function convertConstructionsToGrammar(constructions: Construction[]) {
    const state: State = {
        definitions: new Set(),
        matchSetRuleDefinitions: new Map(),
        ruleNameNextIds: new Map(),
    };
    convertConstructions(state, constructions);
    return writeGrammarRules({
        definitions: Array.from(state.definitions),
        imports: [],
    });
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
    wildcardMode?: WildcardMode,
): RuleDefinition | undefined {
    if (transformInfo === undefined) {
        // Can reuse match set rules only when there are no transforms,
        // since transform-valued rules depend on the specific transform.
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
                // Skip this individual match instead of failing the
                // entire rule definition.
                debugError("Skipping individual match with failed transform");
                continue;
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

    // Add wildcard fallback when the part supports wildcard matching.
    // This mirrors the runtime behavior where constructions fall back
    // to using raw text when a transform lookup fails.
    if (
        wildcardMode !== undefined &&
        wildcardMode !== WildcardMode.Disabled &&
        transformInfo !== undefined
    ) {
        rules.push({
            expressions: [
                {
                    type: "variable",
                    variableName: { name: "wc" },
                    ruleReference: false,
                },
            ],
            value: { type: "variable", name: "wc" },
        });
    }

    if (rules.length === 0) {
        debugError("No valid matches in MatchSet after filtering");
        return undefined;
    }

    const matchSetRuleDefinition = {
        definitionName: { name: getNextRuleName(state, matchSet.name) },
        rules,
    };
    if (transformInfo === undefined) {
        state.matchSetRuleDefinitions.set(matchSet, matchSetRuleDefinition);
    }

    return matchSetRuleDefinition;
}

/**
 * Create a MatchSet rule definition for a part with multiple transforms.
 * Each match produces an object with a property per transform.
 */
function getMultiTransformMatchSetRuleDefinition(
    state: State,
    matchSet: MatchSet,
    translator: MatchedValueTranslator,
    transformInfos: readonly TransformInfo[],
): RuleDefinition | undefined {
    const rules: Rule[] = [];
    for (const match of matchSet.matches) {
        const properties: {
            type: "property";
            key: string;
            value: ValueNode;
        }[] = [];
        let allTransformsSucceeded = true;
        for (const ti of transformInfos) {
            const v = translator.transform(ti, [match]);
            if (v === undefined) {
                allTransformsSucceeded = false;
                break;
            }
            properties.push({
                type: "property",
                key: getPropertyNameFromTransformInfo(ti),
                value: { type: "literal", value: v },
            });
        }
        if (!allTransformsSucceeded) {
            debugError(
                "Skipping individual match with failed transform in multi-transform",
            );
            continue;
        }
        rules.push({
            expressions: [{ type: "string", value: match.split(" ") }],
            value: { type: "object", value: properties },
        });
    }

    if (rules.length === 0) {
        debugError(
            "No valid matches in multi-transform MatchSet after filtering",
        );
        return undefined;
    }

    return {
        definitionName: { name: getNextRuleName(state, matchSet.name) },
        rules,
    };
}

function convertConstruction(
    state: State,
    construction: Construction,
): undefined {
    const translator = getDefaultMatchValueTranslator(
        construction.transformNamespaces,
    );

    // Handle multi-part transforms using cross-product enumeration when
    // any transform in the construction spans multiple parts.
    if (
        construction.parts.some(
            (p) =>
                isMatchPart(p) &&
                p.transformInfos?.some((ti) => ti.partCount !== 1),
        )
    ) {
        return convertMultiPartConstruction(state, construction, translator);
    }

    const result = convertParts(state, construction, translator);
    if (result === undefined) {
        return undefined;
    }

    state.definitions.add({
        definitionName: { name: "Start" },
        rules: [
            {
                expressions: result.expressions,
                value: createValueNode(
                    construction,
                    result.propertyVariables,
                    result.propertyValueOverrides,
                ),
            },
        ],
    });
    for (const rd of result.matchSetRuleDefinitions) {
        state.definitions.add(rd);
    }
}

type ConvertPartsResult = {
    expressions: Expr[];
    propertyVariables: Map<string, number>;
    propertyValueOverrides: Map<string, string>;
    matchSetRuleDefinitions: RuleDefinition[];
};

/**
 * Override for a specific part index during grammar export.
 * - `string`: emit as literal string tokens (for multi-part cross-product).
 * - `{ type: "ruleRef", ... }`: emit a variable reference to a composite rule
 *   (for cross-group decomposition).
 * - `"skip"`: omit the part entirely (positions inside a group span that are
 *   covered by a composite rule reference).
 */
type PartOverride =
    | string
    | { type: "ruleRef"; ruleDef: RuleDefinition; propertyName: string }
    | "skip";

/**
 * Convert the parts of a construction into grammar expressions.
 *
 * @param partOverrides When provided, maps part indices to overrides that
 *   replace normal part processing. Used by convertMultiPartConstruction
 *   for cross-product expansion and cross-group decomposition.
 */
function convertParts(
    state: State,
    construction: Construction,
    translator: MatchedValueTranslator,
    partOverrides?: Map<number, PartOverride>,
): ConvertPartsResult | undefined {
    const expressions: Expr[] = [];
    let nextVariableId = 0;
    const propertyVariables = new Map<string, number>();
    // For multi-transform parts, map property name → variable name.
    const propertyValueOverrides = new Map<string, string>();
    const matchSetRuleDefinitions: RuleDefinition[] = [];
    for (let i = 0; i < construction.parts.length; i++) {
        const override = partOverrides?.get(i);
        if (override !== undefined) {
            if (override === "skip") {
                continue;
            }
            if (typeof override === "string") {
                expressions.push({
                    type: "string",
                    value: override.split(" "),
                });
                continue;
            }
            // ruleRef override — emit variable reference to composite rule
            const variableId = nextVariableId++;
            const variableName = `v${variableId}`;
            propertyVariables.set(override.propertyName, variableId);
            matchSetRuleDefinitions.push(override.ruleDef);
            expressions.push({
                type: "variable",
                variableName: { name: variableName },
                refName: { name: override.ruleDef.definitionName.name },
                ruleReference: true,
            });
            continue;
        }

        const part = construction.parts[i];
        // Handle ParsePart (number/percentage parser)
        if (isParsePart(part)) {
            const parsePart = part as ParsePart;
            const parsePartJSON = parsePart.toJSON();
            // Currently only "number" and "percentage" parsers exist in
            // propertyParser.ts; all other value types use transform-based
            // learning. This check is defensive only.
            if (
                parsePartJSON.parserName !== "number" &&
                parsePartJSON.parserName !== "percentage"
            ) {
                throw new Error(
                    `Unsupported parse part type '${parsePartJSON.parserName}' in exportGrammar`,
                );
            }
            const variableId = nextVariableId++;
            const variableName = `v${variableId}`;
            propertyVariables.set(parsePart.propertyName, variableId);
            expressions.push({
                type: "variable",
                variableName: { name: variableName },
                ruleReference: false,
                refName: { name: "number" },
            });
            if (parsePartJSON.parserName === "percentage") {
                expressions.push({
                    type: "string",
                    value: ["%"],
                });
            }
            continue;
        }

        if (!isMatchPart(part)) {
            throw new Error("Unknown part type in exportGrammar");
        }

        const transformInfos = part.transformInfos;
        let variableName: string | undefined;
        let transformInfo: TransformInfo | undefined;
        if (transformInfos !== undefined) {
            const variableId = nextVariableId++;
            variableName = `v${variableId}`;

            if (transformInfos.length === 1) {
                // Single transform — use direct variable reference
                transformInfo = transformInfos[0];
                const propertyName =
                    getPropertyNameFromTransformInfo(transformInfo);
                propertyVariables.set(propertyName, variableId);
            } else {
                // Multi-transform — the MatchSet rule returns an object,
                // and each property is accessed via member expressions.
                for (const ti of transformInfos) {
                    const propertyName = getPropertyNameFromTransformInfo(ti);
                    propertyValueOverrides.set(propertyName, variableName);
                }
            }
        }
        const matchSet = part.matchSet;
        if (matchSet) {
            let ruleDef: RuleDefinition | undefined;
            if (transformInfos !== undefined && transformInfos.length > 1) {
                // Multi-transform: produce object-valued rule
                ruleDef = getMultiTransformMatchSetRuleDefinition(
                    state,
                    matchSet,
                    translator,
                    transformInfos,
                );
            } else {
                ruleDef = getMatchSetRuleDefinition(
                    state,
                    matchSet,
                    translator,
                    transformInfo,
                    part.wildcardMode,
                );
            }

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
                    variableName: { name: variableName },
                    refName: { name: ruleDef.definitionName.name },
                    ruleReference: true,
                });
            } else {
                const expr: Expr = {
                    type: "ruleReference",
                    refName: { name: ruleDef.definitionName.name },
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
                variableName: { name: variableName },
                ruleReference: false,
            });
        }
    }

    return {
        expressions,
        propertyVariables,
        propertyValueOverrides,
        matchSetRuleDefinitions,
    };
}

function createValueNode(
    construction: Construction,
    propertyVariables: Map<string, number>,
    propertyValueOverrides?: Map<string, string>,
    literalPropertyValues?: Map<string, any>,
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

    if (propertyValueOverrides !== undefined) {
        for (const [propertyName, variableName] of propertyValueOverrides) {
            setLeafValue(propertyName, {
                type: "memberExpression",
                object: { type: "variable", name: variableName },
                property: propertyName,
                computed: false,
                optional: false,
            });
        }
    }

    if (literalPropertyValues !== undefined) {
        for (const [propertyName, value] of literalPropertyValues) {
            setLeafValue(propertyName, {
                type: "literal",
                value: value,
            });
        }
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
            value: entry.map((item) => ({
                value: convertToValueNode(item, leafValues),
            })),
        };
    }
    if (typeof entry === "object" && entry !== null) {
        return {
            type: "object",
            value: Object.entries(entry).map(([k, v]) => ({
                type: "property" as const,
                key: k,
                value: convertToValueNode(v, leafValues),
            })),
        };
    }
    throw new Error(`Internal error: invalid value node entry: ${entry}`);
}

function multiPartGroupKey(ti: TransformInfo): string {
    return `${ti.namespace}::${ti.actionIndex ?? ""}::${ti.transformName}`;
}

/**
 * Handle constructions with multi-part transforms (partCount > 1) by
 * enumerating all valid combinations of match texts across the grouped
 * parts and emitting a Start rule alternative for each combination.
 */
function convertMultiPartConstruction(
    state: State,
    construction: Construction,
    translator: MatchedValueTranslator,
): undefined {
    const groups = new Map<string, MultiPartGroup>();
    const multiPartPartIndices = new Set<number>();

    for (let i = 0; i < construction.parts.length; i++) {
        const part = construction.parts[i];
        if (!isMatchPart(part) || part.transformInfos === undefined) continue;

        const hasMulti = part.transformInfos.some((ti) => ti.partCount > 1);
        const hasSingle = part.transformInfos.some((ti) => ti.partCount === 1);
        if (hasMulti && hasSingle) {
            // Mixed multi/single-part transforms on the same part are
            // not supported — fall back to skipping the construction.
            debugError(
                "Skipping construction with mixed multi/single-part transforms on same part",
            );
            return undefined;
        }

        for (const ti of part.transformInfos) {
            if (ti.partCount <= 1) continue;
            const key = multiPartGroupKey(ti);
            let group = groups.get(key);
            if (!group) {
                group = {
                    transformInfo: ti,
                    matchSets: [],
                    partIndices: [],
                };
                groups.set(key, group);
            }
            if (!part.matchSet) {
                // Can't enumerate wildcards for cross-product expansion.
                debugError("Skipping multi-part transform with wildcard part");
                return undefined;
            }
            group.matchSets.push(part.matchSet);
            group.partIndices.push(i);
            multiPartPartIndices.add(i);
        }
    }

    if (groups.size === 0) return undefined;

    // Verify each group collected the expected number of parts.
    for (const group of groups.values()) {
        if (group.matchSets.length !== group.transformInfo.partCount) {
            debugError("Multi-part group has unexpected number of parts");
            return undefined;
        }
    }

    // Compute valid combinations for each group.
    const groupCombos = new Map<string, ValidCombo[]>();

    for (const [key, group] of groups) {
        const crossProduct = computeCrossProduct(
            group.matchSets.map((ms) => [...ms.matches]),
        );
        if (crossProduct.length > MAX_MULTI_PART_COMBINATIONS) {
            debugError(
                "Too many multi-part combinations, skipping construction",
            );
            return undefined;
        }
        const validCombos: ValidCombo[] = [];
        for (const combo of crossProduct) {
            const v = translator.transform(group.transformInfo, combo);
            if (v !== undefined) {
                validCombos.push({ matches: combo, value: v });
            }
        }
        if (validCombos.length === 0) {
            debugError("No valid multi-part combinations");
            return undefined;
        }
        groupCombos.set(key, validCombos);
    }

    // When multiple independent multi-part groups have non-overlapping
    // contiguous spans, decompose into separate composite rules to avoid
    // the multiplicative cross-group explosion.
    if (
        groups.size > 1 &&
        canDecomposeGroups(groups, construction, multiPartPartIndices)
    ) {
        return decomposeMultiPartGroups(
            state,
            construction,
            translator,
            groups,
            groupCombos,
            multiPartPartIndices,
        );
    }

    // Cross product across groups (when a construction has multiple
    // independent multi-part properties).
    const allGroupKeys = [...groupCombos.keys()];
    const groupCrossProduct = computeGroupCrossProduct(
        allGroupKeys,
        groupCombos,
    );
    if (groupCrossProduct.length > MAX_MULTI_PART_COMBINATIONS) {
        debugError("Too many cross-group combinations, skipping");
        return undefined;
    }

    // For each overall combination, produce a Start rule alternative.
    const startRules: Rule[] = [];
    const allMatchSetRuleDefinitions: Set<RuleDefinition> = new Set();

    for (const chosen of groupCrossProduct) {
        const literalPropertyValues = new Map<string, any>();

        // Set multi-part property literals from the chosen combination.
        for (const [key, combo] of chosen) {
            const group = groups.get(key)!;
            const propertyName = getPropertyNameFromTransformInfo(
                group.transformInfo,
            );
            literalPropertyValues.set(propertyName, combo.value);
        }

        // Build a map of part index → literal match text for multi-part parts.
        const partOverrides = new Map<number, PartOverride>();
        const groupPartCounters = new Map<string, number>();
        for (let i = 0; i < construction.parts.length; i++) {
            if (!multiPartPartIndices.has(i)) continue;
            const part = construction.parts[i];
            if (!isMatchPart(part) || part.transformInfos === undefined)
                continue;
            for (const ti of part.transformInfos) {
                if (ti.partCount <= 1) continue;
                const key = multiPartGroupKey(ti);
                const counter = groupPartCounters.get(key) ?? 0;
                const combo = chosen.get(key)!;
                partOverrides.set(i, combo.matches[counter]);
                groupPartCounters.set(key, counter + 1);
                break;
            }
        }

        const result = convertParts(
            state,
            construction,
            translator,
            partOverrides,
        );
        if (result === undefined) {
            continue;
        }

        for (const rd of result.matchSetRuleDefinitions) {
            allMatchSetRuleDefinitions.add(rd);
        }

        startRules.push({
            expressions: result.expressions,
            value: createValueNode(
                construction,
                result.propertyVariables,
                result.propertyValueOverrides,
                literalPropertyValues,
            ),
        });
    }

    if (startRules.length === 0) {
        return undefined;
    }

    state.definitions.add({
        definitionName: { name: "Start" },
        rules: startRules,
    });
    for (const rd of allMatchSetRuleDefinitions) {
        state.definitions.add(rd);
    }
}

type MultiPartGroup = {
    transformInfo: TransformInfo;
    partIndices: number[];
    matchSets: MatchSet[];
};

type ValidCombo = { matches: string[]; value: any };

/**
 * Check whether multiple multi-part groups can be decomposed into separate
 * composite rules instead of requiring a full cross-group product.
 *
 * Requirements:
 * - Group spans (min..max of their part indices) must not overlap.
 * - Parts within a span that don't belong to the group must be non-captured
 *   (no transformInfos) and non-parse.
 */
function canDecomposeGroups(
    groups: Map<string, MultiPartGroup>,
    construction: Construction,
    multiPartPartIndices: Set<number>,
): boolean {
    type Span = { min: number; max: number; indices: Set<number> };
    const spans: Span[] = [];

    for (const group of groups.values()) {
        const min = Math.min(...group.partIndices);
        const max = Math.max(...group.partIndices);
        spans.push({ min, max, indices: new Set(group.partIndices) });
    }

    // Check non-overlapping.
    for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length; j++) {
            if (spans[i].max >= spans[j].min && spans[j].max >= spans[i].min) {
                return false;
            }
        }
    }

    // Check within-span non-group parts are non-captured and non-parse.
    for (const span of spans) {
        for (let pos = span.min; pos <= span.max; pos++) {
            if (span.indices.has(pos)) continue;
            // Also skip parts that belong to another group (shouldn't happen
            // if spans don't overlap, but be safe).
            if (multiPartPartIndices.has(pos)) return false;
            const part = construction.parts[pos];
            if (isParsePart(part)) return false;
            if (isMatchPart(part) && part.transformInfos !== undefined) {
                return false; // Captured part inside span
            }
        }
    }

    return true;
}

/**
 * Decompose multiple independent multi-part groups into separate composite
 * rules, each with N_group alternatives, and a single Start rule that
 * references them. This produces N_A + N_B + ... + 1 rules instead of
 * N_A × N_B × ... Start alternatives.
 */
function decomposeMultiPartGroups(
    state: State,
    construction: Construction,
    translator: MatchedValueTranslator,
    groups: Map<string, MultiPartGroup>,
    groupCombos: Map<string, ValidCombo[]>,
    multiPartPartIndices: Set<number>,
): undefined {
    // Compute each group's span and create a composite rule.
    type GroupSpan = {
        key: string;
        group: MultiPartGroup;
        min: number;
        max: number;
    };
    const groupSpans: GroupSpan[] = [];
    const compositeRules = new Map<string, RuleDefinition>();

    for (const [key, group] of groups) {
        const min = Math.min(...group.partIndices);
        const max = Math.max(...group.partIndices);
        groupSpans.push({ key, group, min, max });

        // Build composite rule alternatives from valid combos.
        const combos = groupCombos.get(key)!;
        const partIndexSet = new Set(group.partIndices);
        const rules: Rule[] = [];

        for (const combo of combos) {
            const expressions: Expr[] = [];
            let comboIdx = 0;

            for (let pos = min; pos <= max; pos++) {
                if (partIndexSet.has(pos)) {
                    // Group part — emit the combo's match text.
                    expressions.push({
                        type: "string",
                        value: combo.matches[comboIdx++].split(" "),
                    });
                } else {
                    // Non-group within-span part — emit as inline literal(s).
                    const part = construction.parts[pos];
                    if (isMatchPart(part) && part.matchSet) {
                        if (part.optional) {
                            const ruleDef = getMatchSetRuleDefinition(
                                state,
                                part.matchSet,
                                translator,
                            );
                            if (ruleDef) {
                                state.definitions.add(ruleDef);
                                expressions.push({
                                    type: "rules",
                                    rules: [
                                        {
                                            expressions: [
                                                {
                                                    type: "ruleReference",
                                                    refName: {
                                                        name: ruleDef
                                                            .definitionName
                                                            .name,
                                                    },
                                                },
                                            ],
                                        },
                                    ],
                                    optional: true,
                                });
                            }
                        } else if (part.matchSet.matches.size === 1) {
                            const match = part.matchSet.matches
                                .values()
                                .next().value!;
                            expressions.push({
                                type: "string",
                                value: match.split(" "),
                            });
                        } else {
                            // Multi-alternative non-captured literal.
                            const ruleDef = getMatchSetRuleDefinition(
                                state,
                                part.matchSet,
                                translator,
                            );
                            if (ruleDef) {
                                state.definitions.add(ruleDef);
                                expressions.push({
                                    type: "ruleReference",
                                    refName: {
                                        name: ruleDef.definitionName.name,
                                    },
                                });
                            }
                        }
                    }
                }
            }

            rules.push({
                expressions,
                value: { type: "literal", value: combo.value },
            });
        }

        const ruleDef: RuleDefinition = {
            definitionName: {
                name: getNextRuleName(state, "multiPart"),
            },
            rules,
        };
        compositeRules.set(key, ruleDef);
        state.definitions.add(ruleDef);
    }

    // Build partOverrides: at each group span start, reference the composite
    // rule; skip all other positions within the span.
    const partOverrides = new Map<number, PartOverride>();
    for (const gs of groupSpans) {
        const group = gs.group;
        const propertyName = getPropertyNameFromTransformInfo(
            group.transformInfo,
        );
        const ruleDef = compositeRules.get(gs.key)!;
        for (let pos = gs.min; pos <= gs.max; pos++) {
            if (pos === gs.min) {
                partOverrides.set(pos, {
                    type: "ruleRef",
                    ruleDef,
                    propertyName,
                });
            } else {
                partOverrides.set(pos, "skip");
            }
        }
    }

    const result = convertParts(state, construction, translator, partOverrides);
    if (result === undefined) {
        return undefined;
    }

    state.definitions.add({
        definitionName: { name: "Start" },
        rules: [
            {
                expressions: result.expressions,
                value: createValueNode(
                    construction,
                    result.propertyVariables,
                    result.propertyValueOverrides,
                ),
            },
        ],
    });
    for (const rd of result.matchSetRuleDefinitions) {
        state.definitions.add(rd);
    }
}

function computeCrossProduct(arrays: string[][]): string[][] {
    if (arrays.length === 0) return [[]];
    const [first, ...rest] = arrays;
    const restProduct = computeCrossProduct(rest);
    return first.flatMap((item) =>
        restProduct.map((combo) => [item, ...combo]),
    );
}

function computeGroupCrossProduct(
    groupKeys: string[],
    groupCombos: Map<string, { matches: string[]; value: any }[]>,
): Map<string, { matches: string[]; value: any }>[] {
    if (groupKeys.length === 0) return [new Map()];
    const [key, ...rest] = groupKeys;
    const combos = groupCombos.get(key)!;
    const restProduct = computeGroupCrossProduct(rest, groupCombos);
    return combos.flatMap((combo) =>
        restProduct.map((restMap) => {
            const m = new Map(restMap);
            m.set(key, combo);
            return m;
        }),
    );
}
