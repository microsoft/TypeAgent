// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Translation-bench scoring (including E+C empty-gold fairness).
 *
 * E — dispatcher `unknown` schema-match throw → zero-action PASS on empty gold
 * C — filter chat.generateResponse / utility.claudeTask from scored chosen
 *
 * Shared non-eval IDs: synthesizer/eligibleActions HARDCODED_NON_EVAL_ACTION_IDS.
 */

import { equalNormalizedObject } from "@typeagent/agent-cache";
import type { AppAction } from "@typeagent/agent-sdk";
import type { TranslationBenchOrder } from "../synthesizer/benchmark.js";
import { HARDCODED_NON_EVAL_ACTION_IDS } from "../synthesizer/eligibleActions.js";

/** Clarify schema used as internal abstention (mirrors dispatcherUtils). */
const DISPATCHER_CLARIFY_NAME = "dispatcher.clarify";

/**
 * Per-field parameter scoring modes for deterministic soft matching.
 * - exact: value must equal expected (default)
 * - exists: key must be present on chosen (value ignored)
 * - nonempty: key must be present and not empty string/array/null/undefined
 * - ignore: field is not scored
 */
export type TranslationBenchParamFieldMode =
    | "exact"
    | "exists"
    | "nonempty"
    | "ignore";

export interface TranslationBenchParameterScoreSpec {
    /** Default mode for fields not listed in `fields` (default: exact). */
    defaultMode?: TranslationBenchParamFieldMode;
    /** Per top-level parameter field mode. */
    fields?: Record<string, TranslationBenchParamFieldMode>;
}

export interface TranslationBenchAction {
    schemaName: string;
    actionName: string;
    parameters?: Record<string, unknown>;
}

export interface TranslationBenchScore {
    /** Primary gate: route + parameter score specs (soft when specs present). */
    passed: boolean;
    /** Full deep-equal on all parameters, ignoring score specs. */
    exactPassed: boolean;
    /** Translator produced parseable actions with no validation error. */
    schemaValid: boolean;
    expectedCount: number;
    chosenCount: number;
    routed: number;
    paramMatches: number;
    /** Deep-equal parameter matches (always exact). */
    exactParamMatches: number;
    isNegative: boolean;
    firedOnNegative: boolean;
    diagnostics: TranslationBenchDiagnosticCounts;
}

export interface TranslationBenchDiagnosticCounts {
    wrongRouteOrAction: number;
    missingRequiredParameter: number;
    extraneousParameter: number;
    wrongParameterType: number;
    wrongValue: number;
    invalidJsonOrTranslationFailure: number;
}

function routeMatches(a: TranslationBenchAction, b: TranslationBenchAction): boolean {
    return a.schemaName === b.schemaName && a.actionName === b.actionName;
}

function isNonemptyParamValue(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

export function resolveTranslationBenchParamFieldMode(
    spec: TranslationBenchParameterScoreSpec | undefined,
    field: string,
): TranslationBenchParamFieldMode {
    return spec?.fields?.[field] ?? spec?.defaultMode ?? "exact";
}

/**
 * Deterministic parameter match using optional per-field score specs.
 * Specs are typically LLM-authored at dataset generation time and then frozen.
 */
export function parametersMatch(
    expected: TranslationBenchAction,
    chosen: TranslationBenchAction,
    spec?: TranslationBenchParameterScoreSpec,
): boolean {
    const expectedParams = expected.parameters ?? {};
    const chosenParams = chosen.parameters ?? {};
    if (spec === undefined) {
        return equalNormalizedObject(expectedParams, chosenParams);
    }

    const defaultMode = spec.defaultMode ?? "exact";
    for (const key of Object.keys(expectedParams)) {
        const mode = resolveTranslationBenchParamFieldMode(spec, key);
        if (mode === "ignore") continue;
        const hasKey = Object.prototype.hasOwnProperty.call(chosenParams, key);
        if (mode === "exists") {
            if (!hasKey) return false;
            continue;
        }
        if (mode === "nonempty") {
            if (!hasKey || !isNonemptyParamValue(chosenParams[key])) {
                return false;
            }
            continue;
        }
        // exact
        if (
            !hasKey ||
            !equalNormalizedObject(
                { value: expectedParams[key] },
                { value: chosenParams[key] },
            )
        ) {
            return false;
        }
    }

    // Extraneous chosen keys fail under exact default (legacy behavior),
    // unless the key is explicitly ignored or only-exists scored.
    if (defaultMode === "exact") {
        for (const key of Object.keys(chosenParams)) {
            const mode = resolveTranslationBenchParamFieldMode(spec, key);
            if (mode === "ignore" || mode === "exists" || mode === "nonempty") {
                continue;
            }
            if (!Object.prototype.hasOwnProperty.call(expectedParams, key)) {
                return false;
            }
        }
    }
    return true;
}

function parametersMatchExact(
    expected: TranslationBenchAction,
    chosen: TranslationBenchAction,
): boolean {
    return equalNormalizedObject(
        expected.parameters ?? {},
        chosen.parameters ?? {},
    );
}

interface TranslationBenchAlignment {
    routed: number;
    paramMatches: number;
    exactParamMatches: number;
    pairs: { expectedIndex: number; chosenIndex: number }[];
}

function alignStrict(
    expected: TranslationBenchAction[],
    chosen: TranslationBenchAction[],
    parameterScore?: Array<TranslationBenchParameterScoreSpec | undefined>,
): TranslationBenchAlignment {
    let routed = 0;
    let paramMatches = 0;
    let exactParamMatches = 0;
    const pairs: TranslationBenchAlignment["pairs"] = [];
    const count = Math.min(expected.length, chosen.length);
    for (let i = 0; i < count; i++) {
        const e = expected[i]!;
        const c = chosen[i]!;
        if (routeMatches(e, c)) {
            routed++;
            pairs.push({ expectedIndex: i, chosenIndex: i });
            if (parametersMatch(e, c, parameterScore?.[i])) paramMatches++;
            if (parametersMatchExact(e, c)) exactParamMatches++;
        }
    }
    return { routed, paramMatches, exactParamMatches, pairs };
}

function alignAny(
    expected: TranslationBenchAction[],
    chosen: TranslationBenchAction[],
    parameterScore?: Array<TranslationBenchParameterScoreSpec | undefined>,
): TranslationBenchAlignment {
    const chosenUsed = new Set<number>();
    const expectedUsed = new Set<number>();
    let paramMatches = 0;
    let exactParamMatches = 0;
    const pairs: TranslationBenchAlignment["pairs"] = [];

    // Prefer soft (or exact) parameter matches first within a route group.
    for (
        let expectedIndex = 0;
        expectedIndex < expected.length;
        expectedIndex++
    ) {
        const e = expected[expectedIndex]!;
        const match = chosen.findIndex(
            (c, index) =>
                !chosenUsed.has(index) &&
                routeMatches(e, c) &&
                parametersMatch(e, c, parameterScore?.[expectedIndex]),
        );
        if (match >= 0) {
            chosenUsed.add(match);
            expectedUsed.add(expectedIndex);
            pairs.push({ expectedIndex, chosenIndex: match });
            paramMatches++;
            if (parametersMatchExact(e, chosen[match]!)) exactParamMatches++;
        }
    }

    let routed = paramMatches;
    for (let i = 0; i < expected.length; i++) {
        const e = expected[i]!;
        if (expectedUsed.has(i)) continue;
        const match = chosen.findIndex(
            (c, index) => !chosenUsed.has(index) && routeMatches(e, c),
        );
        if (match >= 0) {
            chosenUsed.add(match);
            pairs.push({ expectedIndex: i, chosenIndex: match });
            routed++;
            if (parametersMatchExact(e, chosen[match]!)) exactParamMatches++;
        }
    }
    return { routed, paramMatches, exactParamMatches, pairs };
}

export function createEmptyTranslationBenchDiagnosticCounts(): TranslationBenchDiagnosticCounts {
    return {
        wrongRouteOrAction: 0,
        missingRequiredParameter: 0,
        extraneousParameter: 0,
        wrongParameterType: 0,
        wrongValue: 0,
        invalidJsonOrTranslationFailure: 0,
    };
}

function jsonKind(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}

function diagnoseParameterValue(
    expected: unknown,
    chosen: unknown,
    counts: TranslationBenchDiagnosticCounts,
): void {
    if (equalNormalizedObject({ value: expected }, { value: chosen })) return;
    if (jsonKind(expected) !== jsonKind(chosen)) {
        counts.wrongParameterType++;
        return;
    }
    if (Array.isArray(expected) && Array.isArray(chosen)) {
        const count = Math.min(expected.length, chosen.length);
        const before = Object.values(counts).reduce(
            (sum, value) => sum + value,
            0,
        );
        for (let index = 0; index < count; index++) {
            diagnoseParameterValue(expected[index], chosen[index], counts);
        }
        counts.missingRequiredParameter += Math.max(
            0,
            expected.length - chosen.length,
        );
        counts.extraneousParameter += Math.max(
            0,
            chosen.length - expected.length,
        );
        const after = Object.values(counts).reduce(
            (sum, value) => sum + value,
            0,
        );
        if (before === after) counts.wrongValue++;
        return;
    }
    if (
        expected !== null &&
        chosen !== null &&
        typeof expected === "object" &&
        typeof chosen === "object"
    ) {
        const expectedRecord = expected as Record<string, unknown>;
        const chosenRecord = chosen as Record<string, unknown>;
        const before = Object.values(counts).reduce(
            (sum, value) => sum + value,
            0,
        );
        for (const key of Object.keys(expectedRecord)) {
            if (!Object.prototype.hasOwnProperty.call(chosenRecord, key)) {
                counts.missingRequiredParameter++;
            } else {
                diagnoseParameterValue(
                    expectedRecord[key],
                    chosenRecord[key],
                    counts,
                );
            }
        }
        for (const key of Object.keys(chosenRecord)) {
            if (!Object.prototype.hasOwnProperty.call(expectedRecord, key)) {
                counts.extraneousParameter++;
            }
        }
        const after = Object.values(counts).reduce(
            (sum, value) => sum + value,
            0,
        );
        if (before === after) counts.wrongValue++;
        return;
    }
    counts.wrongValue++;
}

function diagnoseTranslationError(
    error: string,
    counts: TranslationBenchDiagnosticCounts,
): void {
    const prefix = "JSON validation failed:";
    if (!error.startsWith(prefix)) {
        counts.invalidJsonOrTranslationFailure = 1;
        return;
    }
    const primary = error.slice(prefix.length).trimStart().split("\n", 1)[0]!;
    if (/^(Missing actionName property|Unknown action name:)/.test(primary)) {
        counts.wrongRouteOrAction = 1;
    } else if (/^Missing required property /.test(primary)) {
        counts.missingRequiredParameter = 1;
    } else if (/^Extraneous property /.test(primary)) {
        counts.extraneousParameter = 1;
    } else if (
        /does not match any union type|should not be null|is not an (?:object|array|string)|is not a (?:number|boolean), got/.test(
            primary,
        )
    ) {
        counts.wrongParameterType = 1;
    } else if (/ is not .*?, got .* instead$/.test(primary)) {
        counts.wrongValue = 1;
    } else {
        counts.invalidJsonOrTranslationFailure = 1;
    }
}

function diagnoseParametersWithScoreSpec(
    expectedParams: Record<string, unknown>,
    chosenParams: Record<string, unknown>,
    counts: TranslationBenchDiagnosticCounts,
    spec: TranslationBenchParameterScoreSpec | undefined,
): void {
    if (spec === undefined) {
        diagnoseParameterValue(expectedParams, chosenParams, counts);
        return;
    }

    const defaultMode = spec.defaultMode ?? "exact";
    const scoredExpected: Record<string, unknown> = {};
    const scoredChosen: Record<string, unknown> = {};

    for (const key of Object.keys(expectedParams)) {
        const mode = resolveTranslationBenchParamFieldMode(spec, key);
        if (mode === "ignore") continue;
        const hasKey = Object.prototype.hasOwnProperty.call(chosenParams, key);
        if (mode === "exists") {
            if (!hasKey) counts.missingRequiredParameter++;
            continue;
        }
        if (mode === "nonempty") {
            if (!hasKey) {
                counts.missingRequiredParameter++;
            } else if (!isNonemptyParamValue(chosenParams[key])) {
                counts.wrongValue++;
            }
            continue;
        }
        // exact — defer to structural diagnose for type/value/missing.
        scoredExpected[key] = expectedParams[key];
        if (hasKey) scoredChosen[key] = chosenParams[key];
    }

    if (defaultMode === "exact") {
        for (const key of Object.keys(chosenParams)) {
            const mode = resolveTranslationBenchParamFieldMode(spec, key);
            if (mode === "ignore" || mode === "exists" || mode === "nonempty") {
                continue;
            }
            if (!Object.prototype.hasOwnProperty.call(expectedParams, key)) {
                scoredChosen[key] = chosenParams[key];
            }
        }
    }

    diagnoseParameterValue(scoredExpected, scoredChosen, counts);
}

export function diagnoseTranslationBench(
    expected: TranslationBenchAction[],
    chosen: TranslationBenchAction[],
    order: TranslationBenchOrder,
    error?: string,
    parameterScore?: Array<TranslationBenchParameterScoreSpec | undefined>,
): TranslationBenchDiagnosticCounts {
    const counts = createEmptyTranslationBenchDiagnosticCounts();
    if (error !== undefined) {
        diagnoseTranslationError(error, counts);
        return counts;
    }
    const alignment =
        order === "strict"
            ? alignStrict(expected, chosen, parameterScore)
            : alignAny(expected, chosen, parameterScore);
    counts.wrongRouteOrAction =
        Math.max(expected.length, chosen.length) - alignment.routed;
    for (const pair of alignment.pairs) {
        const spec = parameterScore?.[pair.expectedIndex];
        diagnoseParametersWithScoreSpec(
            expected[pair.expectedIndex]!.parameters ?? {},
            chosen[pair.chosenIndex]!.parameters ?? {},
            counts,
            spec,
        );
    }
    return counts;
}

export function scoreTranslationBench(
    expected: TranslationBenchAction[],
    chosen: TranslationBenchAction[],
    order: TranslationBenchOrder,
    abstentionCount = 0,
    options?: {
        parameterScore?: Array<TranslationBenchParameterScoreSpec | undefined>;
        /** When false, translator failed validation / threw. Default true. */
        schemaValid?: boolean;
    },
): TranslationBenchScore {
    const parameterScore = options?.parameterScore;
    const schemaValid = options?.schemaValid ?? true;
    const { routed, paramMatches, exactParamMatches } =
        order === "strict"
            ? alignStrict(expected, chosen, parameterScore)
            : alignAny(expected, chosen, parameterScore);
    const isNegative = expected.length === 0;
    const softPassed =
        schemaValid &&
        expected.length === chosen.length &&
        paramMatches === expected.length &&
        !(abstentionCount > 0 && chosen.length > 0);
    const exactPassed =
        schemaValid &&
        expected.length === chosen.length &&
        exactParamMatches === expected.length &&
        !(abstentionCount > 0 && chosen.length > 0);
    return {
        passed: softPassed,
        exactPassed,
        schemaValid: schemaValid && !(abstentionCount > 0 && chosen.length > 0),
        expectedCount: expected.length,
        chosenCount: chosen.length,
        routed,
        paramMatches,
        exactParamMatches,
        isNegative,
        firedOnNegative: isNegative && chosen.length > 0,
        diagnostics: diagnoseTranslationBench(
            expected,
            chosen,
            order,
            undefined,
            parameterScore,
        ),
    };
}

function toEvalAction(action: AppAction): TranslationBenchAction {
    return {
        schemaName: action.schemaName ?? "",
        actionName: action.actionName,
        ...(action.parameters ? { parameters: action.parameters } : {}),
    };
}

function isInternalAbstention(action: AppAction): boolean {
    // Mirrors dispatcher isUnknownAction + DispatcherClarifyName.
    return (
        action.actionName === "unknown" ||
        action.schemaName === DISPATCHER_CLARIFY_NAME
    );
}

/** Re-export shared non-eval IDs (single source: synthesizer/eligibleActions). */
export const TRANSLATION_BENCH_NON_EVAL_ACTION_IDS: ReadonlySet<string> =
    HARDCODED_NON_EVAL_ACTION_IDS;

export function translationBenchActionId(action: {
    schemaName?: string;
    actionName: string;
}): string {
    const schema = action.schemaName ?? "";
    return schema ? `${schema}.${action.actionName}` : action.actionName;
}

export function isNonEvalTranslationBenchAction(action: {
    schemaName?: string;
    actionName: string;
}): boolean {
    return HARDCODED_NON_EVAL_ACTION_IDS.has(translationBenchActionId(action));
}

/**
 * Dispatcher throws when the model returns the internal `unknown` abstention
 * action (`Unable to match schema name for action unknown`) before the runner
 * can filter it via `isInternalAbstention`. That is a correct zero-action
 * refusal on empty-gold, not a translation failure.
 */
export function isUnknownActionSchemaMatchError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return /Unable to match schema name for action ['"]?unknown['"]?\b/i.test(
        message,
    );
}

/** Drop internal abstentions + non-eval actions from the scored chosen list. */
export function toScoredTranslationBenchActions(
    actions: readonly AppAction[],
): {
    rawChosenActions: TranslationBenchAction[];
    chosenActions: TranslationBenchAction[];
    abstentionCount: number;
} {
    const rawChosenActions = actions.map(toEvalAction);
    const withoutAbstention = actions.filter(
        (action) => !isInternalAbstention(action),
    );
    const abstentionCount = actions.length - withoutAbstention.length;
    const chosenActions = withoutAbstention
        .map(toEvalAction)
        .filter((action) => !isNonEvalTranslationBenchAction(action));
    return { rawChosenActions, chosenActions, abstentionCount };
}

/**
 * Build a row score from either a successful translation or a caught error.
 * Unknown-schema-match throws are scored as successful zero-action abstention.
 */
export function scoreTranslationBenchTranslationOutcome(
    expectedActions: TranslationBenchAction[],
    order: TranslationBenchOrder,
    outcome:
        | { ok: true; actions: readonly AppAction[] }
        | { ok: false; error: unknown },
    parameterScore?: Array<TranslationBenchParameterScoreSpec | undefined>,
): {
    rawChosenActions: TranslationBenchAction[];
    chosenActions: TranslationBenchAction[];
    score: TranslationBenchScore;
    error?: string;
} {
    const scoreOptions = {
        ...(parameterScore !== undefined ? { parameterScore } : {}),
    };

    if (outcome.ok) {
        const { rawChosenActions, chosenActions, abstentionCount } =
            toScoredTranslationBenchActions(outcome.actions);
        return {
            rawChosenActions,
            chosenActions,
            score: scoreTranslationBench(
                expectedActions,
                chosenActions,
                order,
                abstentionCount,
                { ...scoreOptions, schemaValid: true },
            ),
        };
    }

    if (isUnknownActionSchemaMatchError(outcome.error)) {
        // Model abstained via `unknown`; dispatcher threw before filter ran.
        const rawChosenActions: TranslationBenchAction[] = [
            { schemaName: "", actionName: "unknown" },
        ];
        return {
            rawChosenActions,
            chosenActions: [],
            score: scoreTranslationBench(
                expectedActions,
                [],
                order,
                /* abstentionCount */ 1,
                { ...scoreOptions, schemaValid: true },
            ),
            // No row.error — this is a scored abstention, not a harness failure.
        };
    }

    const error =
        outcome.error instanceof Error
            ? outcome.error.message
            : String(outcome.error);
    const score = scoreTranslationBench(
        expectedActions,
        [],
        order,
        0,
        { ...scoreOptions, schemaValid: false },
    );
    score.passed = false;
    score.exactPassed = false;
    score.schemaValid = false;
    score.diagnostics = diagnoseTranslationBench(
        expectedActions,
        [],
        order,
        error,
        parameterScore,
    );
    return {
        rawChosenActions: [],
        chosenActions: [],
        score,
        error,
    };
}
