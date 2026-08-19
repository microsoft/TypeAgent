// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";

import {
    fromJSONParsedActionSchema,
    parseToolsJsonSchema,
    toJSONParsedActionSchema,
    validateAction,
    type ParsedActionSchemaJSON,
} from "@typeagent/action-schema";
import type {
    ActionManifest,
    ActionContext,
    AppAction,
    AppAgentManifest,
    SchemaTypeNames,
} from "@typeagent/agent-sdk";
import { getChatModelNames, openai as ai } from "@typeagent/aiclient";
import { equalNormalizedObject } from "@typeagent/agent-cache";
import { ActionSchemaFileCache } from "agent-dispatcher/internal";
import {
    type ActionConfig,
    convertToActionConfig,
} from "agent-dispatcher/internal";
import type {
    ActionConfigProvider,
    ActionSchemaFile,
} from "agent-dispatcher/internal";
import {
    computeTranslationBenchCanonicalJsonHash,
    type TranslationBenchOrder,
    type OpenAIFunctionTool,
} from "../synthesizer/benchmark.js";
import { HARDCODED_NON_EVAL_ACTION_IDS } from "../synthesizer/eligibleActions.js";
import type { CommandHandlerContext } from "agent-dispatcher/internal";
import {
    createChatHistory,
    type ChatHistoryInput,
    isChatHistoryInput,
} from "agent-dispatcher/internal";
import {
    DispatcherClarifyName,
    isUnknownAction,
} from "agent-dispatcher/internal";
import type {
    CollisionStrategy,
    DispatcherConfig,
    Session,
} from "agent-dispatcher/internal";
import { createHistoryContext } from "agent-dispatcher/internal";
import { translateRequest } from "agent-dispatcher/internal";
import type { RateLimiter } from "../../core/rateLimiter.js";
import { estimatePromptTokens } from "../../core/tokenEstimate.js";
import { DEFAULT_EST_TOKENS_PER_CALL } from "../runConfig.js";

// TranslationBenchOrder / OpenAIFunctionTool are defined in benchmark/translationBenchBenchmark
// and imported above for suite/seed contracts (not re-exported — avoids barrel clash).

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

export interface TranslationBenchLineage {
    dataset: string;
    revision: string;
    config: string;
    split: string;
    rowIndex: number;
    rowId: string;
    sourceUrl: string;
    sourceHash: string;
    sourcePart?: string;
    rawRowHash?: string;
    sourceSliceHash?: string;
    canonicalPayloadHash?: string;
    transformVersion: number;
    derived?: true;
}

export interface TranslationBenchSeed {
    utterance: string;
    expectedActions: TranslationBenchAction[];
    order: TranslationBenchOrder;
    history?: ChatHistoryInput;
    /**
     * Optional per-expected-action parameter score specs (by index).
     * When omitted, every parameter field is scored with exact match.
     * LLM dataset builders mint these so free-text fields (e.g. title)
     * can be `exists`/`nonempty` while times stay `exact`.
     */
    parameterScore?: Array<TranslationBenchParameterScoreSpec | undefined>;
}

export interface TranslationBenchCase {
    id: string;
    lineage: TranslationBenchLineage;
    activeSchemas: string[];
    seed: TranslationBenchSeed;
    explainer?: TranslationBenchExplainerSpec;
    dimensions?: Record<string, string | number | boolean>;
}

export interface TranslationBenchExplainerProbe extends TranslationBenchSeed {
    id: string;
    role: "positive" | "negative";
    lineage: TranslationBenchLineage;
    dimensions?: Record<string, string | number | boolean>;
}

export interface TranslationBenchExplainerSpec {
    valueInRequest: boolean;
    noReferences: boolean;
    probes: TranslationBenchExplainerProbe[];
}

export interface TranslationBenchSchema {
    schemaName: string;
    description: string;
    tools: OpenAIFunctionTool[];
    typeAgent?: {
        sourceHash: string;
        schemaType: string | SchemaTypeNames;
        parsedActionSchema: ParsedActionSchemaJSON;
    };
}

export interface TranslationBenchPricing {
    inputUsdPerMToken: number;
    cachedInputUsdPerMToken: number;
    outputUsdPerMToken: number;
    source: string;
    asOf: string;
}

export interface TranslationBenchSuite {
    version: 1;
    name: string;
    schemas: TranslationBenchSchema[];
    cases: TranslationBenchCase[];
    scenarios?: TranslationBenchScenario[];
    pricing?: Record<string, TranslationBenchPricing>;
}

/** Suite-level lineage index for eval rows (not the synthesizer pin manifest). */
export interface TranslationBenchSuiteSourceIndex {
    version: 1;
    sources: TranslationBenchLineage[];
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

export interface TranslationBenchShape {
    actionCount: "zero" | "single" | "multi";
    parameterCount: "zero" | "one" | "many";
    history: boolean;
    order: TranslationBenchOrder;
    nested: boolean;
    array: boolean;
    resultReference: boolean;
    key: string;
}

export interface TranslationBenchUsage {
    calls: number;
    promptTokens: number | undefined;
    completionTokens: number | undefined;
    cachedTokens: number | undefined;
    reasoningTokens: number | undefined;
    estimatedCostUsd: number | undefined;
}

export interface TranslationBenchRow {
    caseId: string;
    scenarioId: string;
    scenario: TranslationBenchScenario;
    lineage: TranslationBenchLineage;
    model: string;
    activeSchemas: string[];
    activeSchemaCount: number;
    activeActionCount: number;
    utterance: string;
    history?: ChatHistoryInput;
    dimensions?: Record<string, string | number | boolean>;
    order: TranslationBenchOrder;
    expectedActions: TranslationBenchAction[];
    chosenActions: TranslationBenchAction[];
    rawChosenActions: TranslationBenchAction[];
    score: TranslationBenchScore;
    shape: TranslationBenchShape;
    elapsedMs: number;
    usage: TranslationBenchUsage;
    error?: string;
}

export interface TranslationBenchAggregateUsage {
    promptTokens: number | undefined;
    completionTokens: number | undefined;
    cachedTokens: number | undefined;
    reasoningTokens: number | undefined;
    estimatedCostUsd: number | undefined;
}

export interface TranslationBenchSummary {
    totalCases: number;
    passedCases: number;
    exactPassedCases: number;
    schemaValidCases: number;
    expectedCount: number;
    routed: number;
    paramMatches: number;
    negativeRows: number;
    negativeRowsFired: number;
    negativeRowErrors: number;
    errors: number;
    passRate: number;
    exactPassRate: number;
    schemaValidRate: number;
    toolScore: number | undefined;
    paramScore: number | undefined;
    falseNegativeRate: number | undefined;
    falsePositiveRate: number | undefined;
    diagnostics: TranslationBenchDiagnosticCounts;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    usage: TranslationBenchAggregateUsage;
}

export interface TranslationBenchBreakdown {
    key: string;
    summary: TranslationBenchSummary;
}

export interface TranslationBenchRunResult {
    rows: TranslationBenchRow[];
    summary: TranslationBenchSummary;
    byModel: TranslationBenchBreakdown[];
    byScenario: TranslationBenchBreakdown[];
    byActionCount: TranslationBenchBreakdown[];
    byAction: TranslationBenchBreakdown[];
    byDimension: TranslationBenchBreakdown[];
    byShape: TranslationBenchBreakdown[];
    schemaHashes: Record<string, string>;
    settings: {
        models: string[];
        scenarios: TranslationBenchScenario[];
        strategy: CollisionStrategy;
        concurrency: number;
        streaming: false;
        activeSchemaMode: "case-pinned";
        schemaSwitching: true;
        attachments: false;
        userContext: boolean;
        activityContext: boolean;
        sourceManifestHash: string;
        translation: Record<string, unknown>;
        execution: Record<string, unknown>;
        collision: Record<string, unknown>;
    };
}

export interface TranslationBenchRunnerOptions {
    models: string[];
    scenarios?: TranslationBenchScenario[];
    /** Default per-model case concurrency when not listed in concurrencyByModel. */
    concurrency?: number;
    /**
     * Per-model case concurrency override (e.g. gpt-5.6-sol → 300, claude → 3).
     * Keys must match options.models entries exactly.
     */
    concurrencyByModel?: Readonly<Record<string, number>>;
    /**
     * How many models to evaluate in parallel (default 1 = sequential models).
     * Each model still respects its own case concurrency.
     */
    modelConcurrency?: number;
    sourceManifest: TranslationBenchSuiteSourceIndex;
    availableModels?: string[];
    /**
     * Rows already completed (e.g. loaded from an append-only JSONL checkpoint).
     * Included in the final result; matching work is skipped when
     * `isWorkComplete` returns true.
     */
    seedRows?: readonly TranslationBenchRow[];
    /** Return true to skip model/scenario/case work already checkpointed. */
    isWorkComplete?: (work: {
        model: string;
        scenarioId: string;
        caseId: string;
    }) => boolean;
    /**
     * Invoked once per newly computed row (not for seed rows), serialized so
     * concurrent workers can safely append JSONL trajectory checkpoints.
     */
    onRowComplete?: (row: TranslationBenchRow) => void | Promise<void>;
    /**
     * Optional cross-process TPM limiter. When set, each translate call is
     * reserved/settled against the shared ledger for `model`.
     */
    rateLimiter?: RateLimiter;
    /**
     * Token estimate for rate-limiter pre-reservation. Defaults to
     * `estimatePromptTokens(utterance)` when omitted.
     */
    estimateTokens?: (input: { model: string; utterance: string }) => number;
    /**
     * Retry transient translate failures (route 404, throttle, fetch blips).
     * Permanent model/content errors are not retried.
     */
    translateRetry?: {
        maxAttempts?: number;
        baseDelayMs?: number;
        maxDelayMs?: number;
        isRetryable?: (error: unknown) => boolean;
    };
}

export interface TranslationBenchScenario {
    id: string;
    history: { mode: "case" | "none"; limit: number };
    recentActions: { enabled: boolean; limit: number };
    additionalInstructions: boolean;
    entityPromptShape: "facets" | "flat" | "facets-with-schema";
    userContext: "none" | "active-schema";
    activityContext: "none";
    schemaOptimization: { enabled: boolean; numInitialActions: number };
}

/**
 * Baseline scenario knobs mirror `defaultSessionConfig` in session.ts so
 * translation-bench "baseline" matches product defaults (not an empty/minimal profile).
 *
 * Note: case `activeSchemas` is separate — product default is all
 * default-enabled schemas active (not empty). Eval requires non-empty
 * `activeSchemas` and passes them explicitly into translation.
 */
export function getDefaultTranslationBenchScenario(): TranslationBenchScenario {
    return {
        id: "baseline",
        history: { mode: "case", limit: 20 },
        recentActions: { enabled: true, limit: 3 },
        additionalInstructions: true,
        entityPromptShape: "facets-with-schema",
        userContext: "none",
        activityContext: "none",
        // Matches defaultSessionConfig.translation.schema.optimize
        schemaOptimization: { enabled: false, numInitialActions: 5 },
    };
}

/**
 * Collapse known behavioral aliases so gold and model surface forms that mean
 * the same user intent can match.
 *
 * registerPageDynamicAgent{agentName} is a weaker spelling of
 * detectPageActions{registerAgent:true, agentName} — the latter carries the
 * registerAgent flag the utterance implies ("register … and find actions").
 */
export function canonicalizeTranslationBenchAction(
    action: TranslationBenchAction,
): TranslationBenchAction {
    if (
        action.schemaName === "browser.actionDiscovery" &&
        action.actionName === "registerPageDynamicAgent"
    ) {
        const agentName = action.parameters?.agentName;
        return {
            schemaName: "browser.actionDiscovery",
            actionName: "detectPageActions",
            parameters: {
                registerAgent: true,
                ...(agentName !== undefined ? { agentName } : {}),
            },
        };
    }
    return action;
}

function routeMatches(
    a: TranslationBenchAction,
    b: TranslationBenchAction,
): boolean {
    const left = canonicalizeTranslationBenchAction(a);
    const right = canonicalizeTranslationBenchAction(b);
    return (
        left.schemaName === right.schemaName &&
        left.actionName === right.actionName
    );
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
    const canonicalExpected = canonicalizeTranslationBenchAction(expected);
    const canonicalChosen = canonicalizeTranslationBenchAction(chosen);
    const expectedParams = canonicalExpected.parameters ?? {};
    const chosenParams = canonicalChosen.parameters ?? {};
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
    const canonicalExpected = canonicalizeTranslationBenchAction(expected);
    const canonicalChosen = canonicalizeTranslationBenchAction(chosen);
    return equalNormalizedObject(
        canonicalExpected.parameters ?? {},
        canonicalChosen.parameters ?? {},
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

const TRANSLATION_BENCH_PARAM_FIELD_MODES =
    new Set<TranslationBenchParamFieldMode>([
        "exact",
        "exists",
        "nonempty",
        "ignore",
    ]);

function validateParameterScoreSpecs(
    evalCase: TranslationBenchCase,
    parameterScore:
        | Array<TranslationBenchParameterScoreSpec | undefined>
        | undefined,
): void {
    if (parameterScore === undefined) return;
    if (!Array.isArray(parameterScore)) {
        throw new Error(
            `Case '${evalCase.id}' seed.parameterScore must be an array`,
        );
    }
    if (parameterScore.length > evalCase.seed.expectedActions.length) {
        throw new Error(
            `Case '${evalCase.id}' seed.parameterScore length exceeds expectedActions`,
        );
    }
    parameterScore.forEach((spec, index) => {
        if (spec === undefined || spec === null) return;
        if (typeof spec !== "object" || Array.isArray(spec)) {
            throw new Error(
                `Case '${evalCase.id}' seed.parameterScore[${index}] must be an object`,
            );
        }
        if (spec.defaultMode !== undefined) {
            if (!TRANSLATION_BENCH_PARAM_FIELD_MODES.has(spec.defaultMode)) {
                throw new Error(
                    `Case '${evalCase.id}' seed.parameterScore[${index}].defaultMode is invalid`,
                );
            }
        }
        if (spec.fields !== undefined) {
            if (
                spec.fields === null ||
                typeof spec.fields !== "object" ||
                Array.isArray(spec.fields)
            ) {
                throw new Error(
                    `Case '${evalCase.id}' seed.parameterScore[${index}].fields must be an object`,
                );
            }
            for (const [field, mode] of Object.entries(spec.fields)) {
                if (!field.trim()) {
                    throw new Error(
                        `Case '${evalCase.id}' seed.parameterScore[${index}] has an empty field name`,
                    );
                }
                if (!TRANSLATION_BENCH_PARAM_FIELD_MODES.has(mode)) {
                    throw new Error(
                        `Case '${evalCase.id}' seed.parameterScore[${index}].fields.${field} is invalid`,
                    );
                }
            }
        }
    });
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
    // Single-action gold uses any-alignment even when the case order is
    // "strict": the expected action may appear after an extra sibling
    // (e.g. detectPageActions{} + registerPageDynamicAgent{name}).
    const alignOrder =
        expected.length === 1 && chosen.length > 1 ? "any" : order;
    const { routed, paramMatches, exactParamMatches } =
        alignOrder === "strict"
            ? alignStrict(expected, chosen, parameterScore)
            : alignAny(expected, chosen, parameterScore);
    const isNegative = expected.length === 0;
    // Single-action gold: extra chosen actions are OK when the expected action
    // is present with matching params (models often split detect+register).
    // Multi-action gold still requires equal length.
    const lengthOk =
        expected.length === chosen.length ||
        (expected.length === 1 && chosen.length > 1);
    const softPassed =
        schemaValid &&
        lengthOk &&
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
            alignOrder,
            undefined,
            parameterScore,
        ),
    };
}

function inspectValue(
    value: unknown,
    state: { nested: boolean; array: boolean; resultReference: boolean },
    depth: number,
) {
    if (Array.isArray(value)) {
        state.array = true;
        for (const item of value) inspectValue(item, state, depth + 1);
        return;
    }
    if (value === null || typeof value !== "object") return;
    if (depth > 0) state.nested = true;
    if ("$result" in value) state.resultReference = true;
    for (const child of Object.values(value)) {
        inspectValue(child, state, depth + 1);
    }
}

export function getTranslationBenchShape(
    seed: TranslationBenchSeed,
    hasEffectiveHistory = seed.history !== undefined,
): TranslationBenchShape {
    const parameterTotal = seed.expectedActions.reduce(
        (sum, action) => sum + Object.keys(action.parameters ?? {}).length,
        0,
    );
    const state = { nested: false, array: false, resultReference: false };
    for (const action of seed.expectedActions) {
        inspectValue(action.parameters ?? {}, state, 0);
    }
    const actionCount =
        seed.expectedActions.length === 0
            ? "zero"
            : seed.expectedActions.length === 1
              ? "single"
              : "multi";
    const parameterCount =
        parameterTotal === 0 ? "zero" : parameterTotal === 1 ? "one" : "many";
    const history = hasEffectiveHistory;
    const key = [
        `actions=${actionCount}`,
        `params=${parameterCount}`,
        `history=${history ? "yes" : "no"}`,
        `order=${seed.order}`,
        `nested=${state.nested ? "yes" : "no"}`,
        `array=${state.array ? "yes" : "no"}`,
        `resultRef=${state.resultReference ? "yes" : "no"}`,
    ].join(";");
    return {
        actionCount,
        parameterCount,
        history,
        order: seed.order,
        ...state,
        key,
    };
}

function percentile(values: number[], fraction: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(fraction * sorted.length) - 1]!;
}

/**
 * Sum defined numeric samples. Missing values are skipped so a handful of
 * failed/no-usage rows cannot blank an entire summary Prompt/Output/Cost column.
 * Returns undefined only when nothing known was present.
 */
function sumKnown(values: (number | undefined)[]): number | undefined {
    let sum = 0;
    let saw = false;
    for (const value of values) {
        if (value === undefined) continue;
        sum += value;
        saw = true;
    }
    return saw ? sum : undefined;
}

export function aggregateTranslationBenchRows(
    rows: TranslationBenchRow[],
): TranslationBenchSummary {
    const expectedCount = rows.reduce(
        (sum, row) => sum + row.score.expectedCount,
        0,
    );
    const routed = rows.reduce((sum, row) => sum + row.score.routed, 0);
    const paramMatches = rows.reduce(
        (sum, row) => sum + row.score.paramMatches,
        0,
    );
    const negativeRows = rows.filter(
        (row) => row.score.isNegative && row.error === undefined,
    ).length;
    const negativeRowsFired = rows.filter(
        (row) => row.score.firedOnNegative && row.error === undefined,
    ).length;
    const negativeRowErrors = rows.filter(
        (row) => row.score.isNegative && row.error !== undefined,
    ).length;
    const latencies = rows.map((row) => row.elapsedMs);
    const diagnostics = rows.reduce<TranslationBenchDiagnosticCounts>(
        (total, row) => {
            for (const key of Object.keys(
                total,
            ) as (keyof TranslationBenchDiagnosticCounts)[]) {
                total[key] += row.score.diagnostics[key];
            }
            return total;
        },
        createEmptyTranslationBenchDiagnosticCounts(),
    );
    const passedCases = rows.filter((row) => row.score.passed).length;
    const exactPassedCases = rows.filter((row) => row.score.exactPassed).length;
    const schemaValidCases = rows.filter((row) => row.score.schemaValid).length;
    return {
        totalCases: rows.length,
        passedCases,
        exactPassedCases,
        schemaValidCases,
        expectedCount,
        routed,
        paramMatches,
        negativeRows,
        negativeRowsFired,
        negativeRowErrors,
        errors: rows.filter((row) => row.error !== undefined).length,
        passRate: rows.length === 0 ? 0 : passedCases / rows.length,
        exactPassRate: rows.length === 0 ? 0 : exactPassedCases / rows.length,
        schemaValidRate: rows.length === 0 ? 0 : schemaValidCases / rows.length,
        toolScore: expectedCount === 0 ? undefined : routed / expectedCount,
        paramScore: routed === 0 ? undefined : paramMatches / routed,
        falseNegativeRate:
            expectedCount === 0 ? undefined : 1 - routed / expectedCount,
        falsePositiveRate:
            negativeRows === 0 ? undefined : negativeRowsFired / negativeRows,
        diagnostics,
        avgLatencyMs:
            rows.length === 0
                ? 0
                : latencies.reduce((sum, value) => sum + value, 0) /
                  rows.length,
        p50LatencyMs: percentile(latencies, 0.5),
        p95LatencyMs: percentile(latencies, 0.95),
        usage: {
            promptTokens: sumKnown(rows.map((row) => row.usage.promptTokens)),
            completionTokens: sumKnown(
                rows.map((row) => row.usage.completionTokens),
            ),
            cachedTokens: sumKnown(rows.map((row) => row.usage.cachedTokens)),
            reasoningTokens: sumKnown(
                rows.map((row) => row.usage.reasoningTokens),
            ),
            estimatedCostUsd: sumKnown(
                rows.map((row) => row.usage.estimatedCostUsd),
            ),
        },
    };
}

export function createTranslationBenchUsageAccumulator() {
    let calls = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let cachedTokens = 0;
    let reasoningTokens = 0;
    let baseValid = true;
    let cachedComplete = true;
    let cachedValid = true;
    let reasoningComplete = true;
    let reasoningValid = true;
    return {
        add(usage: ai.CompletionUsageStats) {
            calls++;
            if (
                !Number.isFinite(usage.prompt_tokens) ||
                usage.prompt_tokens < 0 ||
                !Number.isFinite(usage.completion_tokens) ||
                usage.completion_tokens < 0 ||
                !Number.isFinite(usage.total_tokens) ||
                usage.total_tokens < 0
            ) {
                baseValid = false;
            }
            promptTokens += usage.prompt_tokens;
            completionTokens += usage.completion_tokens;
            const extra = usage as {
                cached_tokens?: number;
                reasoning_tokens?: number;
            };
            if (extra.cached_tokens === undefined) cachedComplete = false;
            else {
                cachedTokens += extra.cached_tokens;
                if (
                    !Number.isFinite(extra.cached_tokens) ||
                    extra.cached_tokens < 0 ||
                    extra.cached_tokens > usage.prompt_tokens
                ) {
                    cachedValid = false;
                }
            }
            if (extra.reasoning_tokens === undefined) reasoningComplete = false;
            else {
                reasoningTokens += extra.reasoning_tokens;
                if (
                    !Number.isFinite(extra.reasoning_tokens) ||
                    extra.reasoning_tokens < 0 ||
                    extra.reasoning_tokens > usage.completion_tokens
                ) {
                    reasoningValid = false;
                }
            }
        },
        finish(pricing?: TranslationBenchPricing): TranslationBenchUsage {
            const knownCached =
                calls > 0 && baseValid && cachedComplete && cachedValid
                    ? cachedTokens
                    : undefined;
            const knownReasoning =
                calls > 0 && baseValid && reasoningComplete && reasoningValid
                    ? reasoningTokens
                    : undefined;
            // Cost: prefer real cached split when the provider reported it on
            // every call. If cached is missing/incomplete, bill full prompt at
            // the input rate (cached=0) so Cost is not N/A for Azure/LiteLLM
            // routes that omit cached_tokens.
            const cachedForCost =
                knownCached !== undefined && cachedValid ? knownCached : 0;
            const canPrice =
                calls > 0 &&
                baseValid &&
                pricing !== undefined &&
                // When cached was reported but invalid (e.g. cached > prompt),
                // refuse to invent a cost.
                (knownCached !== undefined ? cachedValid : true);
            const estimatedCostUsd = canPrice
                ? ((promptTokens - cachedForCost) * pricing!.inputUsdPerMToken +
                      cachedForCost * pricing!.cachedInputUsdPerMToken +
                      completionTokens * pricing!.outputUsdPerMToken) /
                  1_000_000
                : undefined;
            return {
                calls,
                promptTokens: calls > 0 && baseValid ? promptTokens : undefined,
                completionTokens:
                    calls > 0 && baseValid ? completionTokens : undefined,
                cachedTokens: knownCached,
                reasoningTokens: knownReasoning,
                estimatedCostUsd,
            };
        },
    };
}

function normalizeTools(schema: TranslationBenchSchema) {
    return schema.tools.map((tool) => {
        if (tool.type !== "function") {
            throw new Error(
                `Schema '${schema.schemaName}' contains a non-function tool`,
            );
        }
        return {
            name: tool.function.name,
            description: tool.function.description,
            inputSchema: tool.function.parameters,
        };
    });
}

function schemaMap(suite: TranslationBenchSuite) {
    return new Map(suite.schemas.map((schema) => [schema.schemaName, schema]));
}

function lineageKey(lineage: TranslationBenchLineage): string {
    return JSON.stringify([
        lineage.dataset,
        lineage.revision,
        lineage.config,
        lineage.split,
        lineage.rowIndex,
        lineage.rowId,
        lineage.sourcePart ?? "",
        lineage.transformVersion,
        ...(lineage.derived === true
            ? [lineage.canonicalPayloadHash ?? lineage.sourceHash]
            : []),
    ]);
}

function sourceRowKey(lineage: TranslationBenchLineage): string {
    return JSON.stringify([
        lineage.dataset,
        lineage.revision,
        lineage.config,
        lineage.split,
        lineage.rowIndex,
        lineage.rowId,
        lineage.sourcePart ?? "",
        ...(lineage.derived === true
            ? [lineage.canonicalPayloadHash ?? lineage.sourceHash]
            : []),
    ]);
}

function lineageMatches(
    left: TranslationBenchLineage,
    right: TranslationBenchLineage,
): boolean {
    return (
        left.dataset === right.dataset &&
        left.revision === right.revision &&
        left.config === right.config &&
        left.split === right.split &&
        left.rowIndex === right.rowIndex &&
        left.rowId === right.rowId &&
        left.sourceUrl === right.sourceUrl &&
        left.sourceHash === right.sourceHash &&
        left.sourcePart === right.sourcePart &&
        left.rawRowHash === right.rawRowHash &&
        left.sourceSliceHash === right.sourceSliceHash &&
        left.canonicalPayloadHash === right.canonicalPayloadHash &&
        left.transformVersion === right.transformVersion &&
        left.derived === right.derived
    );
}

function sourceManifestMap(manifest: TranslationBenchSuiteSourceIndex) {
    if (manifest.version !== 1) {
        throw new Error(
            `Unsupported translation bench source manifest version: ${manifest.version}`,
        );
    }
    if (manifest.sources.length === 0) {
        throw new Error("Translation bench source manifest is empty");
    }
    const sources = new Map<string, TranslationBenchLineage>();
    for (const source of manifest.sources) {
        const key = lineageKey(source);
        if (sources.has(key)) {
            throw new Error(
                `Duplicate translation bench source '${source.rowId}'`,
            );
        }
        sources.set(key, source);
    }
    return sources;
}

export function computeTranslationBenchSourceHash(
    suite: TranslationBenchSuite,
    evalCase: TranslationBenchCase,
): string {
    return computeTranslationBenchProbeHash(
        suite,
        evalCase.activeSchemas,
        evalCase.seed,
        evalCase.lineage.transformVersion >= 2,
    );
}

export function computeTranslationBenchProbeHash(
    suite: TranslationBenchSuite,
    activeSchemaNames: string[],
    probe: TranslationBenchSeed,
    canonicalize = false,
): string {
    const schemas = schemaMap(suite);
    const activeSchemas = activeSchemaNames.map((name) => {
        const schema = schemas.get(name);
        if (!schema) throw new Error(`Unknown active schema '${name}'`);
        return schema;
    });
    const payload = {
        utterance: probe.utterance,
        ...(probe.history ? { history: probe.history } : {}),
        activeSchemas,
        expectedActions: probe.expectedActions,
        order: probe.order,
    };
    return canonicalize
        ? computeTranslationBenchCanonicalJsonHash(payload)
        : createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function requireLineageText(
    evalCase: TranslationBenchCase,
    field: keyof TranslationBenchLineage,
) {
    const value = evalCase.lineage[field];
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(
            `Case '${evalCase.id}' has an invalid lineage.${field}`,
        );
    }
}

export function validateTranslationBenchSuite(
    suite: TranslationBenchSuite,
    sourceManifest: TranslationBenchSuiteSourceIndex,
): void {
    if (suite.version !== 1) {
        throw new Error(
            `Unsupported translation bench suite version: ${suite.version}`,
        );
    }
    if (!suite.name.trim())
        throw new Error("Translation bench suite name is required");
    if (suite.schemas.length === 0) {
        throw new Error("Translation bench suite requires at least one schema");
    }
    if (suite.cases.length === 0) {
        throw new Error("Translation bench suite requires at least one case");
    }
    if (suite.scenarios !== undefined) {
        validateTranslationBenchScenarios(suite.scenarios);
    }
    if (suite.pricing !== undefined) {
        for (const [model, pricing] of Object.entries(suite.pricing)) {
            if (
                !model.trim() ||
                pricing === null ||
                typeof pricing !== "object"
            ) {
                throw new Error(
                    `Translation bench pricing for '${model}' is invalid`,
                );
            }
            if (model !== model.trim()) {
                throw new Error(
                    `Translation bench pricing model key '${model}' must not contain surrounding whitespace`,
                );
            }
            for (const field of [
                "inputUsdPerMToken",
                "cachedInputUsdPerMToken",
                "outputUsdPerMToken",
            ] as const) {
                const value = pricing[field];
                if (!Number.isFinite(value) || value < 0) {
                    throw new Error(
                        `Translation bench pricing '${model}.${field}' must be a finite non-negative number`,
                    );
                }
            }
            if (!pricing.source?.trim() || !pricing.asOf?.trim()) {
                throw new Error(
                    `Translation bench pricing for '${model}' requires source and asOf`,
                );
            }
        }
    }

    const schemas = schemaMap(suite);
    const trustedSources = sourceManifestMap(sourceManifest);
    if (schemas.size !== suite.schemas.length) {
        throw new Error("Translation bench schema names must be unique");
    }
    for (const schema of suite.schemas) {
        if (schema.schemaName.startsWith(DispatcherClarifyName)) {
            throw new Error(
                `Translation bench schema '${schema.schemaName}' uses the reserved dispatcher clarify namespace`,
            );
        }
    }
    const parsedSchemas = new Map(
        suite.schemas.map((schema) => [
            schema.schemaName,
            schema.typeAgent === undefined
                ? parseToolsJsonSchema(normalizeTools(schema))
                : fromJSONParsedActionSchema(
                      structuredClone(schema.typeAgent.parsedActionSchema),
                  ),
        ]),
    );
    const caseIds = new Set<string>();
    const caseSources = new Set<string>();
    const translationNegativeSources = new Map<
        string,
        TranslationBenchLineage
    >();
    const explainerNegativeSources = new Map<string, TranslationBenchLineage>();
    for (const evalCase of suite.cases) {
        if (!evalCase.id.trim() || caseIds.has(evalCase.id)) {
            throw new Error(
                `Duplicate or empty translation bench case id '${evalCase.id}'`,
            );
        }
        caseIds.add(evalCase.id);
        const sourceKey = sourceRowKey(evalCase.lineage);
        const isTranslationNegative =
            evalCase.seed.expectedActions.length === 0 &&
            evalCase.explainer === undefined;
        const matchingExplainerNegative =
            explainerNegativeSources.get(sourceKey);
        const reusesExplainerNegative =
            isTranslationNegative &&
            !translationNegativeSources.has(sourceKey) &&
            matchingExplainerNegative !== undefined &&
            lineageMatches(evalCase.lineage, matchingExplainerNegative);
        if (caseSources.has(sourceKey) && !reusesExplainerNegative) {
            throw new Error(
                `Duplicate translation bench source row '${evalCase.lineage.rowId}'`,
            );
        }
        caseSources.add(sourceKey);
        if (isTranslationNegative) {
            translationNegativeSources.set(sourceKey, evalCase.lineage);
        }
        for (const field of [
            "dataset",
            "revision",
            "config",
            "split",
            "rowId",
            "sourceUrl",
            "sourceHash",
        ] as const) {
            requireLineageText(evalCase, field);
        }
        if (
            !Number.isInteger(evalCase.lineage.rowIndex) ||
            evalCase.lineage.rowIndex < 0
        ) {
            throw new Error(
                `Case '${evalCase.id}' has an invalid lineage.rowIndex`,
            );
        }
        if (
            !Number.isInteger(evalCase.lineage.transformVersion) ||
            evalCase.lineage.transformVersion < 1
        ) {
            throw new Error(
                `Case '${evalCase.id}' has an invalid lineage.transformVersion`,
            );
        }
        const trusted = trustedSources.get(lineageKey(evalCase.lineage));
        if (trusted === undefined) {
            throw new Error(
                `Case '${evalCase.id}' is not present in the trusted source manifest`,
            );
        }
        if (!lineageMatches(evalCase.lineage, trusted)) {
            throw new Error(
                `Case '${evalCase.id}' lineage differs from the trusted source manifest`,
            );
        }
        const url = new URL(evalCase.lineage.sourceUrl);
        // Curated offline banks may use curated:; public rows stay on HTTP(S).
        if (
            url.protocol !== "https:" &&
            url.protocol !== "http:" &&
            url.protocol !== "curated:"
        ) {
            throw new Error(
                `Case '${evalCase.id}' lineage.sourceUrl must use HTTP(S) or curated:`,
            );
        }
        if (!evalCase.seed.utterance.trim()) {
            throw new Error(`Case '${evalCase.id}' has an empty utterance`);
        }
        if (
            evalCase.seed.history !== undefined &&
            !isChatHistoryInput(evalCase.seed.history)
        ) {
            throw new Error(`Case '${evalCase.id}' has invalid seed.history`);
        }
        if (evalCase.seed.order !== "strict" && evalCase.seed.order !== "any") {
            throw new Error(`Case '${evalCase.id}' has an invalid seed.order`);
        }
        validateParameterScoreSpecs(evalCase, evalCase.seed.parameterScore);
        if (evalCase.activeSchemas.length === 0) {
            throw new Error(`Case '${evalCase.id}' has no active schemas`);
        }
        for (const active of evalCase.activeSchemas) {
            if (!schemas.has(active)) {
                throw new Error(
                    `Case '${evalCase.id}' uses unknown active schema '${active}'`,
                );
            }
        }
        for (const action of evalCase.seed.expectedActions) {
            if (!evalCase.activeSchemas.includes(action.schemaName)) {
                throw new Error(
                    `Case '${evalCase.id}' expects inactive schema '${action.schemaName}'`,
                );
            }
            const parsed = parsedSchemas.get(action.schemaName)!;
            const definition = parsed.actionSchemas.get(action.actionName);
            if (!definition) {
                throw new Error(
                    `Case '${evalCase.id}' expects unknown action '${action.actionName}' in '${action.schemaName}'`,
                );
            }
            validateAction(definition, action);
        }
        const actualHash = computeTranslationBenchSourceHash(suite, evalCase);
        if (actualHash !== evalCase.lineage.sourceHash) {
            throw new Error(
                `Case '${evalCase.id}' sourceHash does not match its utterance, active schemas, and calls`,
            );
        }
        if (evalCase.lineage.sourcePart !== undefined) {
            for (const field of [
                "sourcePart",
                "rawRowHash",
                "sourceSliceHash",
                "canonicalPayloadHash",
            ] as const) {
                requireLineageText(evalCase, field);
            }
            if (
                evalCase.lineage.canonicalPayloadHash !== actualHash ||
                !/^[a-f0-9]{64}$/.test(evalCase.lineage.rawRowHash!) ||
                !/^[a-f0-9]{64}$/.test(evalCase.lineage.sourceSliceHash!)
            ) {
                throw new Error(
                    `Case '${evalCase.id}' has invalid public source hashes`,
                );
            }
        }
        if (evalCase.explainer !== undefined) {
            if (evalCase.seed.expectedActions.length === 0) {
                throw new Error(
                    `Case '${evalCase.id}' cannot explain an abstention seed`,
                );
            }
            if (
                typeof evalCase.explainer.valueInRequest !== "boolean" ||
                typeof evalCase.explainer.noReferences !== "boolean"
            ) {
                throw new Error(
                    `Case '${evalCase.id}' has invalid explainer options`,
                );
            }
            const probeIds = new Set<string>();
            let positives = 0;
            let negatives = 0;
            for (const probe of evalCase.explainer.probes) {
                if (!probe.id.trim() || probeIds.has(probe.id)) {
                    throw new Error(
                        `Case '${evalCase.id}' has a duplicate or empty explainer probe id`,
                    );
                }
                probeIds.add(probe.id);
                if (probe.role === "positive") positives++;
                else if (probe.role === "negative") negatives++;
                else {
                    throw new Error(
                        `Case '${evalCase.id}' has an invalid explainer probe role`,
                    );
                }
                if (
                    (probe.role === "positive" &&
                        probe.expectedActions.length === 0) ||
                    (probe.role === "negative" &&
                        probe.expectedActions.length !== 0)
                ) {
                    throw new Error(
                        `Case '${evalCase.id}' explainer probe '${probe.id}' conflicts with its role`,
                    );
                }
                if (
                    probe.history !== undefined &&
                    !isChatHistoryInput(probe.history)
                ) {
                    throw new Error(
                        `Case '${evalCase.id}' explainer probe '${probe.id}' has invalid history`,
                    );
                }
                const turnKey = sourceRowKey(probe.lineage);
                const matchingTranslationNegative =
                    translationNegativeSources.get(turnKey);
                const reusesTranslationNegative =
                    probe.role === "negative" &&
                    !explainerNegativeSources.has(turnKey) &&
                    matchingTranslationNegative !== undefined &&
                    lineageMatches(probe.lineage, matchingTranslationNegative);
                if (caseSources.has(turnKey) && !reusesTranslationNegative) {
                    throw new Error(
                        `Duplicate translation bench public turn '${probe.lineage.rowId}:${probe.lineage.sourcePart ?? ""}'`,
                    );
                }
                caseSources.add(turnKey);
                if (probe.role === "negative") {
                    explainerNegativeSources.set(turnKey, probe.lineage);
                }
                const trustedProbe = trustedSources.get(
                    lineageKey(probe.lineage),
                );
                if (
                    trustedProbe === undefined ||
                    !lineageMatches(probe.lineage, trustedProbe)
                ) {
                    throw new Error(
                        `Case '${evalCase.id}' explainer probe '${probe.id}' is absent from the trusted source manifest`,
                    );
                }
                const probeHash = computeTranslationBenchProbeHash(
                    suite,
                    evalCase.activeSchemas,
                    probe,
                    probe.lineage.transformVersion >= 2,
                );
                if (
                    probe.lineage.sourcePart === undefined ||
                    probe.lineage.canonicalPayloadHash !== probeHash ||
                    probe.lineage.sourceHash !== probeHash
                ) {
                    throw new Error(
                        `Case '${evalCase.id}' explainer probe '${probe.id}' canonical payload hash drift`,
                    );
                }
                for (const action of probe.expectedActions) {
                    if (!evalCase.activeSchemas.includes(action.schemaName)) {
                        throw new Error(
                            `Case '${evalCase.id}' explainer probe '${probe.id}' expects an inactive schema`,
                        );
                    }
                    const definition = parsedSchemas
                        .get(action.schemaName)!
                        .actionSchemas.get(action.actionName);
                    if (!definition) {
                        throw new Error(
                            `Case '${evalCase.id}' explainer probe '${probe.id}' expects an unknown action`,
                        );
                    }
                    validateAction(definition, action);
                }
            }
            if (positives === 0 || negatives === 0) {
                throw new Error(
                    `Case '${evalCase.id}' explainer requires positive and negative probes`,
                );
            }
        }
    }
}

export function createTranslationBenchProvider(
    suite: TranslationBenchSuite,
    sourceManifest: TranslationBenchSuiteSourceIndex,
): {
    provider: ActionConfigProvider;
    schemaHashes: Record<string, string>;
} {
    validateTranslationBenchSuite(suite, sourceManifest);
    const configs: Record<string, ActionConfig> = {};
    const schemaFiles = new Map<string, ActionSchemaFile>();
    for (const schema of suite.schemas) {
        const parsed =
            schema.typeAgent === undefined
                ? parseToolsJsonSchema(normalizeTools(schema))
                : fromJSONParsedActionSchema(
                      structuredClone(schema.typeAgent.parsedActionSchema),
                  );
        schemaFiles.set(schema.schemaName, {
            schemaName: schema.schemaName,
            sourceHash:
                schema.typeAgent?.sourceHash ??
                createHash("sha256")
                    .update(JSON.stringify(toJSONParsedActionSchema(parsed)))
                    .digest("hex"),
            parsedActionSchema: parsed,
        });
        const manifest: AppAgentManifest = {
            emojiChar: "🧪",
            description: schema.description,
            schema: {
                description: schema.description,
                schemaType: schema.typeAgent?.schemaType ?? "AgentActions",
                schemaFile: {
                    format: "pas",
                    content: JSON.stringify(toJSONParsedActionSchema(parsed)),
                },
            },
        };
        const [rootSchemaName, ...subSchemaNames] =
            schema.schemaName.split(".");
        let nestedManifest: ActionManifest = manifest;
        for (let index = subSchemaNames.length - 1; index >= 0; index--) {
            const subSchemaName = subSchemaNames[index]!;
            nestedManifest = {
                subActionManifests: { [subSchemaName]: nestedManifest },
            };
        }
        convertToActionConfig(
            rootSchemaName!,
            subSchemaNames.length === 0
                ? manifest
                : {
                      emojiChar: manifest.emojiChar,
                      description: manifest.description,
                      ...nestedManifest,
                  },
            configs,
        );
    }
    const cache = new ActionSchemaFileCache();
    const provider: ActionConfigProvider = {
        tryGetActionConfig(schemaName: string) {
            return configs[schemaName];
        },
        getActionConfig(schemaName: string) {
            const config = configs[schemaName];
            if (!config) throw new Error(`Unknown eval schema: ${schemaName}`);
            return config;
        },
        getActionConfigs() {
            return Object.values(configs);
        },
        getActionSchemaFileForConfig(config: ActionConfig): ActionSchemaFile {
            return (
                schemaFiles.get(config.schemaName) ??
                cache.getActionSchemaFile(config)
            );
        },
    };
    const schemaHashes = Object.fromEntries(
        Object.values(configs).map((config) => [
            config.schemaName,
            provider.getActionSchemaFileForConfig(config).sourceHash,
        ]),
    );
    return { provider, schemaHashes };
}

export function validateTranslationBenchModels(
    models: string[],
    availableModels: string[],
): void {
    if (models.length === 0)
        throw new Error("At least one eval model is required");
    if (new Set(models).size !== models.length) {
        throw new Error("Translation bench model names must be unique");
    }
    for (const model of models) {
        if (!availableModels.includes(model)) {
            throw new Error(
                `Translation bench model '${model}' is not configured. Available models: ${availableModels.join(", ")}`,
            );
        }
    }
}

export function resolveTranslationBenchConcurrency(
    requested: number,
    caseCount: number,
): number {
    if (!Number.isSafeInteger(requested) || requested < 1) {
        throw new Error(
            "Translation bench concurrency must be a positive integer",
        );
    }
    return Math.min(requested, Math.max(1, caseCount));
}

export function resolveTranslationBenchModelConcurrency(
    model: string,
    options: Pick<
        TranslationBenchRunnerOptions,
        "concurrency" | "concurrencyByModel"
    >,
    caseCount: number,
): number {
    // Explicit `concurrency` (CLI override) wins over per-model map.
    const requested =
        options.concurrency !== undefined
            ? options.concurrency
            : (options.concurrencyByModel?.[model] ?? 4);
    return resolveTranslationBenchConcurrency(requested, caseCount);
}

async function pmap<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<R>,
    onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    let done = 0;
    async function worker() {
        for (;;) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await fn(items[index]!);
            done++;
            onProgress?.(done, items.length);
        }
    }
    await Promise.all(
        Array.from({ length: Math.max(1, concurrency) }, () => worker()),
    );
    return results;
}

function toEvalAction(action: AppAction): TranslationBenchAction {
    return {
        schemaName: action.schemaName ?? "",
        actionName: action.actionName,
        ...(action.parameters ? { parameters: action.parameters } : {}),
    };
}

function isInternalAbstention(action: AppAction): boolean {
    return (
        isUnknownAction(action) || action.schemaName === DispatcherClarifyName
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
    const message =
        error instanceof Error ? error.message : String(error ?? "");
    return /Unable to match schema name for action ['"]?unknown['"]?\b/i.test(
        message,
    );
}

/**
 * Drop internal abstentions from the scored chosen list.
 *
 * Non-eval actions (`chat.generateResponse`, …) are filtered only when gold
 * expects tool actions — so a sidecar chat ack does not fail a positive.
 * On empty-gold they are kept and count as fires, matching the generation
 * fairness contract (zero-action under the full catalog, including chat).
 */
export function toScoredTranslationBenchActions(
    actions: readonly AppAction[],
    options?: { filterNonEval?: boolean },
): {
    rawChosenActions: TranslationBenchAction[];
    chosenActions: TranslationBenchAction[];
    abstentionCount: number;
} {
    const filterNonEval = options?.filterNonEval !== false;
    const rawChosenActions = actions.map(toEvalAction);
    const withoutAbstention = actions.filter(
        (action) => !isInternalAbstention(action),
    );
    const abstentionCount = actions.length - withoutAbstention.length;
    const chosenActions = withoutAbstention
        .map(toEvalAction)
        .filter(
            (action) =>
                !filterNonEval || !isNonEvalTranslationBenchAction(action),
        );
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
        // Empty-gold: keep chat/non-eval fires so pure_refusal metrics match
        // the generation fairness rule. Positives: drop non-eval sidecars.
        const { rawChosenActions, chosenActions, abstentionCount } =
            toScoredTranslationBenchActions(outcome.actions, {
                filterNonEval: expectedActions.length > 0,
            });
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
            { schemaName: "dispatcher", actionName: "unknown" },
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
    const score = scoreTranslationBench(expectedActions, [], order, 0, {
        ...scoreOptions,
        schemaValid: false,
    });
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

export function compareTranslationBenchKeys(
    left: string,
    right: string,
): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function groupRows(
    rows: TranslationBenchRow[],
    key: (row: TranslationBenchRow) => string,
): TranslationBenchBreakdown[] {
    const groups = new Map<string, TranslationBenchRow[]>();
    for (const row of rows) {
        const groupKey = key(row);
        const group = groups.get(groupKey) ?? [];
        group.push(row);
        groups.set(groupKey, group);
    }
    return [...groups.entries()]
        .sort(([a], [b]) => compareTranslationBenchKeys(a, b))
        .map(([groupKey, group]) => ({
            key: groupKey,
            summary: aggregateTranslationBenchRows(group),
        }));
}

export function groupTranslationBenchRowsByDimensions(
    rows: TranslationBenchRow[],
): TranslationBenchBreakdown[] {
    const groups = new Map<string, TranslationBenchRow[]>();
    for (const row of rows) {
        for (const [name, value] of Object.entries(row.dimensions ?? {})) {
            const key = `model=${row.model};dimension=${JSON.stringify(name)};value=${JSON.stringify(value)}`;
            const group = groups.get(key) ?? [];
            group.push(row);
            groups.set(key, group);
        }
    }
    return [...groups.entries()]
        .sort(([left], [right]) => compareTranslationBenchKeys(left, right))
        .map(([key, group]) => ({
            key,
            summary: aggregateTranslationBenchRows(group),
        }));
}

/**
 * Per-action reliability breakdown. Multi-action rows are attributed to each
 * expected action key so the heatmap can surface weak families.
 */
export function groupTranslationBenchRowsByAction(
    rows: TranslationBenchRow[],
): TranslationBenchBreakdown[] {
    const groups = new Map<string, TranslationBenchRow[]>();
    for (const row of rows) {
        const keys = new Set<string>();
        for (const action of row.expectedActions) {
            keys.add(`${action.schemaName}.${action.actionName}`);
        }
        if (keys.size === 0) {
            keys.add(`${row.model};action=(abstain)`);
        }
        for (const actionKey of keys) {
            const key =
                actionKey === `${row.model};action=(abstain)`
                    ? actionKey
                    : `model=${row.model};action=${actionKey}`;
            const group = groups.get(key) ?? [];
            group.push(row);
            groups.set(key, group);
        }
    }
    return [...groups.entries()]
        .sort(([left], [right]) => compareTranslationBenchKeys(left, right))
        .map(([key, group]) => ({
            key,
            summary: aggregateTranslationBenchRows(group),
        }));
}

export function createTranslationBenchConfig(
    sessionConfig: DispatcherConfig,
    model: string,
    scenario: TranslationBenchScenario = getDefaultTranslationBenchScenario(),
): DispatcherConfig {
    validateTranslationBenchScenarios([scenario]);
    const config = structuredClone(sessionConfig);
    config.translation = {
        enabled: true,
        model,
        stream: false,
        promptConfig: {
            additionalInstructions: scenario.additionalInstructions,
            recentActions: scenario.recentActions.enabled,
            recentActionsLimit: scenario.recentActions.limit,
        },
        switch: {
            fixed: "",
            embedding: true,
            inline: true,
            search: true,
        },
        multiple: { enabled: true, result: true, pending: true },
        history: {
            enabled: scenario.history.mode === "case",
            limit: scenario.history.limit,
        },
        schema: {
            generation: {
                jsonSchema: false,
                jsonSchemaFunction: false,
                jsonSchemaWithTs: false,
                jsonSchemaValidate: true,
            },
            optimize: structuredClone(scenario.schemaOptimization),
        },
        entity: {
            resolve: true,
            filter: true,
            clarify: false,
            pathNavigation: "fallback-to-name",
        },
    };
    config.execution.entityPromptShape = scenario.entityPromptShape;
    config.collision.llmSelect.detect = false;
    config.collision.llmSelect.strategy = "first-match";
    config.collision.preference.enabled = false;
    config.collision.preference.registryFirst = false;
    return config;
}

export function createTranslationBenchRunSettings(
    priorConfig: DispatcherConfig,
    models: string[],
    scenarios: TranslationBenchScenario[],
    concurrency: number,
    sourceManifest: TranslationBenchSuiteSourceIndex,
): TranslationBenchRunResult["settings"] {
    validateTranslationBenchScenarios(scenarios);
    const configs = scenarios.map((scenario) => ({
        scenario,
        config: createTranslationBenchConfig(priorConfig, models[0]!, scenario),
    }));
    return {
        models: [...models],
        scenarios: structuredClone(scenarios),
        strategy: "first-match",
        concurrency,
        streaming: false,
        activeSchemaMode: "case-pinned",
        schemaSwitching: true,
        attachments: false,
        userContext: scenarios.some(
            (scenario) => scenario.userContext !== "none",
        ),
        activityContext: scenarios.some(
            (scenario) => scenario.activityContext !== "none",
        ),
        sourceManifestHash: createHash("sha256")
            .update(JSON.stringify(sourceManifest))
            .digest("hex"),
        translation: Object.fromEntries(
            configs.map(({ scenario, config }) => [
                scenario.id,
                {
                    ...structuredClone(config.translation),
                    model: [...models],
                },
            ]),
        ),
        execution: Object.fromEntries(
            configs.map(({ scenario, config }) => [
                scenario.id,
                {
                    entityPromptShape: config.execution.entityPromptShape,
                },
            ]),
        ),
        collision: Object.fromEntries(
            configs.map(({ scenario, config }) => [
                scenario.id,
                {
                    llmSelect: structuredClone(config.collision.llmSelect),
                    preference: structuredClone(config.collision.preference),
                },
            ]),
        ),
    };
}

export function validateTranslationBenchScenarios(
    scenarios: TranslationBenchScenario[],
): void {
    if (scenarios.length === 0) {
        throw new Error("At least one translation bench scenario is required");
    }
    const ids = new Set<string>();
    for (const scenario of scenarios) {
        if (!scenario.id.trim() || ids.has(scenario.id)) {
            throw new Error(
                `Duplicate or empty translation bench scenario id '${scenario.id}'`,
            );
        }
        ids.add(scenario.id);
        if (
            scenario.history.mode !== "case" &&
            scenario.history.mode !== "none"
        ) {
            throw new Error(
                `Translation bench scenario '${scenario.id}' has invalid history mode`,
            );
        }
        if (
            scenario.entityPromptShape !== "facets" &&
            scenario.entityPromptShape !== "flat" &&
            scenario.entityPromptShape !== "facets-with-schema"
        ) {
            throw new Error(
                `Translation bench scenario '${scenario.id}' has invalid entity prompt shape`,
            );
        }
        if (
            scenario.userContext !== "none" &&
            scenario.userContext !== "active-schema"
        ) {
            throw new Error(
                `Translation bench scenario '${scenario.id}' has invalid user context`,
            );
        }
        if (scenario.activityContext !== "none") {
            throw new Error(
                `Translation bench scenario '${scenario.id}' has unsupported activity context`,
            );
        }
        for (const [name, value] of [
            ["recentActions.enabled", scenario.recentActions.enabled],
            ["additionalInstructions", scenario.additionalInstructions],
            ["schemaOptimization.enabled", scenario.schemaOptimization.enabled],
        ] as const) {
            if (typeof value !== "boolean") {
                throw new Error(
                    `Translation bench scenario '${scenario.id}' ${name} must be boolean`,
                );
            }
        }
        for (const [name, value] of [
            ["history.limit", scenario.history.limit],
            ["recentActions.limit", scenario.recentActions.limit],
            [
                "schemaOptimization.numInitialActions",
                scenario.schemaOptimization.numInitialActions,
            ],
        ] as const) {
            if (!Number.isSafeInteger(value) || value < 0) {
                throw new Error(
                    `Translation bench scenario '${scenario.id}' ${name} must be a non-negative integer`,
                );
            }
        }
    }
}

function createTranslationBenchContext(
    context: ActionContext<CommandHandlerContext>,
    config: DispatcherConfig,
    historyInput?: ChatHistoryInput,
): ActionContext<CommandHandlerContext> {
    const live = context.sessionContext.agentContext;
    const session = new Proxy(live.session, {
        get(target, property) {
            if (property === "getConfig") return () => config;
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    }) as Session;
    // Fresh per-call history + translator cache so concurrent cases cannot
    // race on chatHistory / lastActionSchemaName / pendingTopicalRoute.
    const chatHistory = createChatHistory(true);
    if (historyInput !== undefined) {
        chatHistory.import(historyInput);
    }
    const isolated: CommandHandlerContext = {
        ...live,
        session,
        chatHistory,
        activityContext: undefined,
        lastActionSchemaName: "",
        pendingTopicalRoute: undefined,
        translatorCache: new Map(),
    };
    return {
        ...context,
        sessionContext: {
            ...context.sessionContext,
            agentContext: isolated,
        },
    };
}

const DEFAULT_TRANSLATE_RETRY_ATTEMPTS = 4;
const DEFAULT_TRANSLATE_RETRY_BASE_MS = 400;
const DEFAULT_TRANSLATE_RETRY_MAX_MS = 8_000;

function defaultIsRetryableTranslateError(error: unknown): boolean {
    const message =
        error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error);
    const lower = message.toLowerCase();
    // Route/load-balancer blips and shared-account throttles.
    if (
        /\b404\b/.test(message) &&
        /not found|resource|deployment|route/i.test(message)
    ) {
        return true;
    }
    if (
        /\b429\b/.test(message) ||
        /rate limit|too many requests|throttl/i.test(lower)
    ) {
        return true;
    }
    if (
        /fetch failed|network|econnreset|etimedout|socket hang up|no response/i.test(
            lower,
        )
    ) {
        return true;
    }
    if (
        /temporarily unavailable|service unavailable|\b503\b|\b502\b|\b504\b/i.test(
            lower,
        )
    ) {
        return true;
    }
    return false;
}

function retryDelayMs(attempt: number, baseMs: number, maxMs: number): number {
    const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
    const jitter = Math.floor(Math.random() * Math.min(250, exp * 0.25));
    return Math.min(maxMs, exp + jitter);
}

async function sleepMs(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTranslateRetry<T>(
    run: () => Promise<T>,
    retry: TranslationBenchRunnerOptions["translateRetry"] | undefined,
): Promise<T> {
    const maxAttempts = Math.max(
        1,
        retry?.maxAttempts ?? DEFAULT_TRANSLATE_RETRY_ATTEMPTS,
    );
    const baseDelayMs = retry?.baseDelayMs ?? DEFAULT_TRANSLATE_RETRY_BASE_MS;
    const maxDelayMs = retry?.maxDelayMs ?? DEFAULT_TRANSLATE_RETRY_MAX_MS;
    const isRetryable = retry?.isRetryable ?? defaultIsRetryableTranslateError;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await run();
        } catch (error) {
            lastError = error;
            if (attempt >= maxAttempts || !isRetryable(error)) {
                throw error;
            }
            await sleepMs(retryDelayMs(attempt, baseDelayMs, maxDelayMs));
        }
    }
    throw lastError;
}

export async function runTranslationBench(
    suite: TranslationBenchSuite,
    context: ActionContext<CommandHandlerContext>,
    options: TranslationBenchRunnerOptions,
    onProgress?: (done: number, total: number) => void,
): Promise<TranslationBenchRunResult> {
    const { provider, schemaHashes } = createTranslationBenchProvider(
        suite,
        options.sourceManifest,
    );
    const availableModels =
        options.availableModels ?? (await getChatModelNames());
    validateTranslationBenchModels(options.models, availableModels);
    const scenarios = options.scenarios ??
        suite.scenarios ?? [getDefaultTranslationBenchScenario()];
    validateTranslationBenchScenarios(scenarios);
    const defaultConcurrency = resolveTranslationBenchConcurrency(
        options.concurrency ?? 4,
        suite.cases.length,
    );
    const modelConcurrency = resolveTranslationBenchConcurrency(
        options.modelConcurrency ?? 1,
        options.models.length,
    );
    // Peak case workers across models (for settings + logging).
    const concurrency = Math.max(
        defaultConcurrency,
        ...options.models.map((model) =>
            resolveTranslationBenchModelConcurrency(
                model,
                options,
                suite.cases.length,
            ),
        ),
    );
    const systemContext = context.sessionContext.agentContext;
    const priorConfig = systemContext.session.getConfig();
    const rows: TranslationBenchRow[] = [...(options.seedRows ?? [])];
    const total = options.models.length * scenarios.length * suite.cases.length;
    let progress = rows.length;
    // Serialize checkpoint / trajectory writes across the worker pool.
    let rowCompleteChain: Promise<void> = Promise.resolve();
    const emitRowComplete = async (row: TranslationBenchRow): Promise<void> => {
        if (options.onRowComplete === undefined) {
            return;
        }
        const run = rowCompleteChain.then(
            () => options.onRowComplete!(row),
            () => options.onRowComplete!(row),
        );
        rowCompleteChain = run.then(
            () => undefined,
            () => undefined,
        );
        await run;
    };
    const bumpProgress = () => {
        progress++;
        onProgress?.(progress, total);
    };

    async function computeRow(
        evalCase: TranslationBenchCase,
        model: string,
        scenario: TranslationBenchScenario,
        config: DispatcherConfig,
    ): Promise<TranslationBenchRow> {
        const started = performance.now();
        const usage = createTranslationBenchUsageAccumulator();
        const effectiveHistory =
            scenario.history.mode === "case" && evalCase.seed.history
                ? evalCase.seed.history
                : undefined;
        // Per-case isolated context (fresh chatHistory + translatorCache).
        const evalContext = createTranslationBenchContext(
            context,
            config,
            effectiveHistory,
        );
        const history =
            effectiveHistory !== undefined
                ? createHistoryContext(evalContext.sessionContext.agentContext)
                : undefined;
        let rawChosenActions: TranslationBenchAction[] = [];
        let chosenActions: TranslationBenchAction[] = [];
        let error: string | undefined;
        let score: TranslationBenchScore;
        let elapsedMs: number;
        try {
            const invokeTranslate = async () =>
                translateRequest(
                    evalContext,
                    evalCase.seed.utterance,
                    history,
                    undefined,
                    undefined,
                    evalCase.activeSchemas,
                    (stats) => usage.add(stats),
                    scenario.userContext === "active-schema"
                        ? { activeApp: evalCase.activeSchemas[0]! }
                        : undefined,
                    provider,
                );
            // Full TB prompts dwarf the bare utterance; reserve a floor so the
            // TPM ledger does not under-admit multi-schema translates.
            const estimate =
                options.estimateTokens?.({
                    model,
                    utterance: evalCase.seed.utterance,
                }) ??
                Math.max(
                    estimatePromptTokens(evalCase.seed.utterance),
                    DEFAULT_EST_TOKENS_PER_CALL,
                );
            // Reserve/settle per attempt so retries charge the ledger correctly.
            const translated = await withTranslateRetry(async () => {
                if (options.rateLimiter === undefined) {
                    return invokeTranslate();
                }
                return options.rateLimiter.run(model, estimate, async () => {
                    const result = await invokeTranslate();
                    const finished = usage.finish(suite.pricing?.[model]);
                    const actualTokens =
                        typeof finished.promptTokens === "number" &&
                        typeof finished.completionTokens === "number"
                            ? finished.promptTokens + finished.completionTokens
                            : estimate;
                    return { result, actualTokens };
                });
            }, options.translateRetry);
            elapsedMs = performance.now() - started;
            const raw = translated.requestAction.actions.map(
                (entry) => entry.action,
            );
            const scored = scoreTranslationBenchTranslationOutcome(
                evalCase.seed.expectedActions,
                evalCase.seed.order,
                { ok: true, actions: raw },
                evalCase.seed.parameterScore,
            );
            rawChosenActions = scored.rawChosenActions;
            chosenActions = scored.chosenActions;
            score = scored.score;
            error = scored.error;
        } catch (caught) {
            elapsedMs = performance.now() - started;
            const scored = scoreTranslationBenchTranslationOutcome(
                evalCase.seed.expectedActions,
                evalCase.seed.order,
                { ok: false, error: caught },
                evalCase.seed.parameterScore,
            );
            rawChosenActions = scored.rawChosenActions;
            chosenActions = scored.chosenActions;
            score = scored.score;
            error = scored.error;
        }
        return {
            caseId: evalCase.id,
            scenarioId: scenario.id,
            scenario: structuredClone(scenario),
            lineage: evalCase.lineage,
            model,
            activeSchemas: evalCase.activeSchemas,
            activeSchemaCount: evalCase.activeSchemas.length,
            activeActionCount: evalCase.activeSchemas.reduce(
                (sum, schemaName) =>
                    sum + (schemaMap(suite).get(schemaName)?.tools.length ?? 0),
                0,
            ),
            utterance: evalCase.seed.utterance,
            ...(effectiveHistory !== undefined
                ? { history: structuredClone(effectiveHistory) }
                : {}),
            ...(evalCase.dimensions ? { dimensions: evalCase.dimensions } : {}),
            order: evalCase.seed.order,
            expectedActions: evalCase.seed.expectedActions,
            chosenActions,
            rawChosenActions,
            score,
            shape: getTranslationBenchShape(
                evalCase.seed,
                effectiveHistory !== undefined,
            ),
            elapsedMs,
            usage: usage.finish(suite.pricing?.[model]),
            ...(error ? { error } : {}),
        };
    }

    onProgress?.(progress, total);

    async function runModel(model: string): Promise<TranslationBenchRow[]> {
        const modelRows: TranslationBenchRow[] = [];
        for (const scenario of scenarios) {
            const pendingCases = suite.cases.filter(
                (evalCase) =>
                    options.isWorkComplete?.({
                        model,
                        scenarioId: scenario.id,
                        caseId: evalCase.id,
                    }) !== true,
            );
            if (pendingCases.length === 0) {
                continue;
            }
            const caseConcurrency = resolveTranslationBenchModelConcurrency(
                model,
                options,
                pendingCases.length,
            );
            const config = createTranslationBenchConfig(
                priorConfig,
                model,
                scenario,
            );
            modelRows.push(
                ...(await pmap(
                    pendingCases,
                    caseConcurrency,
                    async (evalCase) => {
                        const row = await computeRow(
                            evalCase,
                            model,
                            scenario,
                            config,
                        );
                        await emitRowComplete(row);
                        return row;
                    },
                    bumpProgress,
                )),
            );
        }
        return modelRows;
    }

    // Models may run in parallel (modelConcurrency); each keeps its own
    // case-level pool (concurrencyByModel / concurrency).
    const modelResults = await pmap(options.models, modelConcurrency, (model) =>
        runModel(model),
    );
    for (const modelRows of modelResults) {
        rows.push(...modelRows);
    }

    return {
        rows,
        summary: aggregateTranslationBenchRows(rows),
        byModel: groupRows(rows, (row) => row.model),
        byScenario: groupRows(
            rows,
            (row) => `model=${row.model};scenario=${row.scenarioId}`,
        ),
        byActionCount: groupRows(rows, (row) => {
            const expectedActions =
                row.expectedActions.length === 0
                    ? "abstain"
                    : row.expectedActions.length === 1
                      ? "single"
                      : `multi-${row.expectedActions.length}`;
            return `model=${row.model};activeActions=${row.activeActionCount};expectedActions=${expectedActions}`;
        }),
        byAction: groupTranslationBenchRowsByAction(rows),
        byDimension: groupTranslationBenchRowsByDimensions(rows),
        byShape: groupRows(
            rows,
            (row) => `model=${row.model};${row.shape.key}`,
        ),
        schemaHashes,
        settings: createTranslationBenchRunSettings(
            priorConfig,
            options.models,
            scenarios,
            concurrency,
            options.sourceManifest,
        ),
    };
}
