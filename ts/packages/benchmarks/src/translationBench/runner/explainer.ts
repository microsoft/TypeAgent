// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AgentCacheFactory,
    createExecutableAction,
    RequestAction,
    type AgentCache,
    type HistoryContext,
} from "@typeagent/agent-cache";
import type {
    ChatModelWithStreaming,
    CompleteUsageStatsCallback,
} from "@typeagent/aiclient";

import type { ActionConfigProvider } from "agent-dispatcher/internal";
import { createSchemaInfoProvider } from "agent-dispatcher/internal";
import {
    createChatHistory,
    type ChatHistoryInput,
} from "agent-dispatcher/internal";
import type { CommandHandlerContext } from "agent-dispatcher/internal";
import { createHistoryContext } from "agent-dispatcher/internal";
import type {
    TranslationBenchAction,
    TranslationBenchCase,
    TranslationBenchExplainerProbe,
    TranslationBenchPricing,
    TranslationBenchScore,
    TranslationBenchUsage,
    TranslationBenchDiagnosticCounts,
} from "./runner.js";
import {
    createEmptyTranslationBenchDiagnosticCounts,
    createTranslationBenchUsageAccumulator,
    diagnoseTranslationBench,
    scoreTranslationBench,
} from "./runner.js";

export type TranslationBenchExplainerProbeKind = "positive" | "negative";

export interface TranslationBenchExplainerProbeRow {
    probeId: string;
    kind: TranslationBenchExplainerProbeKind;
    utterance: string;
    history?: ChatHistoryInput;
    order: TranslationBenchExplainerProbe["order"];
    lineage: TranslationBenchExplainerProbe["lineage"];
    dimensions?: Record<string, string | number | boolean>;
    expectedActions: TranslationBenchAction[];
    chosenActions: TranslationBenchAction[];
    score: TranslationBenchScore;
    hit: boolean;
    matchCount: number;
    elapsedMs: number;
    error?: string;
}

export interface TranslationBenchExplainerSummary {
    ruleCreated: boolean;
    seedReplayPassed: boolean;
    totalProbes: number;
    passedProbes: number;
    passRate: number;
    positiveRows: number;
    positiveRowsPassed: number;
    positivePassRate: number | undefined;
    positiveCoverageRate: number | undefined;
    negativeRows: number;
    negativeRowsPassed: number;
    expectedCount: number;
    routed: number;
    paramMatches: number;
    toolScore: number | undefined;
    paramScore: number | undefined;
    falseNegativeRate: number | undefined;
    falsePositiveRate: number | undefined;
    cacheHitRows: number;
    totalMatches: number;
    collisionRows: number;
    collisionCount: number;
    errors: number;
    diagnostics: TranslationBenchDiagnosticCounts;
}

export interface TranslationBenchRuleRubricInput {
    correctness: number;
    coverage: number;
    overGeneralization: number;
    slotBinding: number;
    specificity: number;
    rationale: string;
}

export type TranslationBenchRuleRubric = TranslationBenchRuleRubricInput & {
    score: number;
};

export interface TranslationBenchRuleJudgeInput {
    seed: {
        utterance: string;
        history?: ChatHistoryInput;
        order: TranslationBenchExplainerProbe["order"];
        lineage: TranslationBenchExplainerProbe["lineage"];
        dimensions?: Record<string, string | number | boolean>;
        expectedActions: TranslationBenchAction[];
    };
    ruleText: string;
    ruleJson: unknown;
    seedReplay: TranslationBenchExplainerProbeRow;
    outcomes: TranslationBenchExplainerProbeRow[];
    summary: TranslationBenchExplainerSummary;
}

export interface TranslationBenchRuleJudge {
    model: string;
    grade(
        input: TranslationBenchRuleJudgeInput,
        usageCallback: CompleteUsageStatsCallback,
    ): Promise<TranslationBenchRuleRubricInput>;
}

export interface TranslationBenchExplainerCaseResult {
    caseId: string;
    model: string;
    explainerName: string;
    valueInRequest: boolean;
    noReferences: boolean;
    ruleCreated: boolean;
    ruleText?: string;
    ruleJson?: unknown;
    explanationData?: unknown;
    explanationElapsedMs: number;
    explanationUsage: TranslationBenchUsage;
    cacheReplayElapsedMs: number;
    seedReplay: TranslationBenchExplainerProbeRow;
    probes: TranslationBenchExplainerProbeRow[];
    summary: TranslationBenchExplainerSummary;
    error?: string;
    rubric?: TranslationBenchRuleRubric;
    rubricModel?: string;
    rubricElapsedMs?: number;
    rubricUsage?: TranslationBenchUsage;
    rubricError?: string;
}

export interface TranslationBenchExplainerRunOptions {
    model: string;
    explainerName?: string;
    pricing?: TranslationBenchPricing;
    judge?: TranslationBenchRuleJudge;
    judgePricing?: TranslationBenchPricing;
}

export interface TranslationBenchExplainerAggregateUsage {
    promptTokens: number | undefined;
    completionTokens: number | undefined;
    cachedTokens: number | undefined;
    reasoningTokens: number | undefined;
    estimatedCostUsd: number | undefined;
}

export interface TranslationBenchExplainerAggregate {
    totalCases: number;
    ruleCreatedCases: number;
    ruleCreationRate: number;
    seedReplayPassedCases: number;
    seedReplayPassRate: number;
    totalProbes: number;
    passedProbes: number;
    passRate: number;
    positiveRows: number;
    positiveRowsPassed: number;
    positivePassRate: number | undefined;
    negativeRows: number;
    negativeRowsFired: number;
    expectedCount: number;
    routed: number;
    paramMatches: number;
    toolScore: number | undefined;
    paramScore: number | undefined;
    falseNegativeRate: number | undefined;
    falsePositiveRate: number | undefined;
    cacheHitRows: number;
    totalMatches: number;
    collisionRows: number;
    collisionCount: number;
    errors: number;
    rubricErrors: number;
    rubricCases: number;
    rubricScoreSum: number;
    rubricScore: number | undefined;
    rubricCriterionSums: Omit<TranslationBenchRuleRubricInput, "rationale">;
    rubricCriteria: Omit<TranslationBenchRuleRubricInput, "rationale"> | undefined;
    diagnostics: TranslationBenchDiagnosticCounts;
    avgExplanationLatencyMs: number;
    avgCacheReplayLatencyMs: number;
    explanationUsage: TranslationBenchExplainerAggregateUsage;
    rubricUsage: TranslationBenchExplainerAggregateUsage;
}

export function createTranslationBenchExplainerMiss(
    probe: TranslationBenchExplainerProbe,
    error?: string,
): TranslationBenchExplainerProbeRow {
    const score = scoreTranslationBench(probe.expectedActions, [], probe.order);
    if (error !== undefined) {
        score.diagnostics = diagnoseTranslationBench(
            probe.expectedActions,
            [],
            probe.order,
            error,
        );
    }
    return {
        probeId: probe.id,
        kind: probe.role,
        utterance: probe.utterance,
        ...(probe.history !== undefined
            ? { history: structuredClone(probe.history) }
            : {}),
        order: probe.order,
        lineage: structuredClone(probe.lineage),
        ...(probe.dimensions !== undefined
            ? { dimensions: structuredClone(probe.dimensions) }
            : {}),
        expectedActions: probe.expectedActions,
        chosenActions: [],
        score,
        hit: false,
        matchCount: 0,
        elapsedMs: 0,
        ...(error ? { error } : {}),
    };
}

export function validateTranslationBenchRuleRubric(
    rubric: TranslationBenchRuleRubricInput,
): TranslationBenchRuleRubric {
    const criteria = [
        "correctness",
        "coverage",
        "overGeneralization",
        "slotBinding",
        "specificity",
    ] as const;
    for (const criterion of criteria) {
        const value = rubric[criterion];
        if (!Number.isFinite(value) || value < 0 || value > 1) {
            throw new Error(
                `Translation bench rubric ${criterion} must be between 0 and 1`,
            );
        }
    }
    if (!rubric.rationale.trim()) {
        throw new Error("Translation bench rubric rationale is required");
    }
    return {
        ...rubric,
        score:
            criteria.reduce((sum, criterion) => sum + rubric[criterion], 0) /
            criteria.length,
    };
}

export function scoreTranslationBenchExplainer(
    rows: TranslationBenchExplainerProbeRow[],
    ruleCreated: boolean,
    seedReplayPassed: boolean,
): TranslationBenchExplainerSummary {
    const positives = rows.filter((row) => row.kind === "positive");
    const negatives = rows.filter((row) => row.kind === "negative");
    const expectedCount = positives.reduce(
        (sum, row) => sum + row.score.expectedCount,
        0,
    );
    const routed = positives.reduce((sum, row) => sum + row.score.routed, 0);
    const paramMatches = positives.reduce(
        (sum, row) => sum + row.score.paramMatches,
        0,
    );
    const positiveRowsPassed = positives.filter(
        (row) => row.score.passed,
    ).length;
    const negativeRowsPassed = negatives.filter(
        (row) => !row.hit && row.error === undefined,
    ).length;
    const cacheHitRows = rows.filter((row) => row.hit).length;
    const totalMatches = rows.reduce((sum, row) => sum + row.matchCount, 0);
    const collisionRows = rows.filter((row) => row.matchCount > 1).length;
    const collisionCount = rows.reduce(
        (sum, row) => sum + Math.max(0, row.matchCount - 1),
        0,
    );
    const passedProbes = positiveRowsPassed + negativeRowsPassed;
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
    return {
        ruleCreated,
        seedReplayPassed,
        totalProbes: rows.length,
        passedProbes,
        passRate: rows.length === 0 ? 0 : passedProbes / rows.length,
        positiveRows: positives.length,
        positiveRowsPassed,
        positivePassRate:
            positives.length === 0
                ? undefined
                : positiveRowsPassed / positives.length,
        positiveCoverageRate:
            positives.length === 0
                ? undefined
                : positives.filter((row) => row.hit).length / positives.length,
        negativeRows: negatives.length,
        negativeRowsPassed,
        expectedCount,
        routed,
        paramMatches,
        toolScore: expectedCount === 0 ? undefined : routed / expectedCount,
        paramScore: routed === 0 ? undefined : paramMatches / routed,
        falseNegativeRate:
            expectedCount === 0 ? undefined : 1 - routed / expectedCount,
        falsePositiveRate:
            negatives.length === 0
                ? undefined
                : negatives.filter((row) => row.hit).length / negatives.length,
        cacheHitRows,
        totalMatches,
        collisionRows,
        collisionCount,
        errors: rows.filter((row) => row.error !== undefined).length,
        diagnostics,
    };
}

function toHistory(
    context: CommandHandlerContext,
    input: ChatHistoryInput | undefined,
): HistoryContext | undefined {
    if (input === undefined) return undefined;
    const chatHistory = createChatHistory(true);
    chatHistory.import(input);
    const config = structuredClone(context.session.getConfig());
    config.translation.history = { enabled: true, limit: 20 };
    config.translation.promptConfig.additionalInstructions = false;
    config.translation.promptConfig.recentActions = false;
    config.translation.promptConfig.recentActionsLimit = 0;
    const session = new Proxy(context.session, {
        get(target, property) {
            if (property === "getConfig") return () => config;
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    // createHistoryContext reads context.chatHistory — must be the imported one.
    return createHistoryContext({
        ...context,
        session,
        chatHistory,
        activityContext: undefined,
    });
}

function toEvalAction(action: {
    schemaName?: string;
    actionName: string;
    parameters?: Record<string, unknown>;
}): TranslationBenchAction {
    return {
        schemaName: action.schemaName ?? "",
        actionName: action.actionName,
        ...(action.parameters !== undefined
            ? { parameters: action.parameters }
            : {}),
    };
}

function replayProbe(
    cache: AgentCache | undefined,
    probe: TranslationBenchExplainerProbe,
    namespaceKeys: string[],
    context: CommandHandlerContext,
): TranslationBenchExplainerProbeRow {
    const started = performance.now();
    try {
        const history = toHistory(context, probe.history);
        const matches =
            cache?.match(probe.utterance, {
                namespaceKeys,
                history,
                wildcard: true,
                entityWildcard: true,
                rejectReferences: history === undefined,
            }) ?? [];
        const chosenActions =
            matches[0]?.match.actions.map((entry) =>
                toEvalAction(entry.action),
            ) ?? [];
        return {
            probeId: probe.id,
            kind: probe.role,
            utterance: probe.utterance,
            ...(probe.history !== undefined
                ? { history: structuredClone(probe.history) }
                : {}),
            order: probe.order,
            lineage: structuredClone(probe.lineage),
            ...(probe.dimensions !== undefined
                ? { dimensions: structuredClone(probe.dimensions) }
                : {}),
            expectedActions: probe.expectedActions,
            chosenActions,
            score: scoreTranslationBench(
                probe.expectedActions,
                chosenActions,
                probe.order,
            ),
            hit: matches.length > 0,
            matchCount: matches.length,
            elapsedMs: performance.now() - started,
        };
    } catch (error) {
        const missed = createTranslationBenchExplainerMiss(
            probe,
            error instanceof Error ? error.message : String(error),
        );
        missed.elapsedMs = performance.now() - started;
        return missed;
    }
}

function seedAsProbe(evalCase: TranslationBenchCase): TranslationBenchExplainerProbe {
    return {
        id: `${evalCase.id}:seed-replay`,
        role: "positive",
        lineage: evalCase.lineage,
        ...(evalCase.dimensions !== undefined
            ? { dimensions: structuredClone(evalCase.dimensions) }
            : {}),
        ...evalCase.seed,
    };
}

export function getTranslationBenchExplainerNamespaceKeys(
    cache: AgentCache,
    evalCase: TranslationBenchCase,
): string[] {
    const seedSchemas = [
        ...new Set(
            evalCase.seed.expectedActions.map((action) => action.schemaName),
        ),
    ];
    return cache.getNamespaceKeys(seedSchemas, undefined);
}

export async function runTranslationBenchExplainerCase(
    evalCase: TranslationBenchCase,
    provider: ActionConfigProvider,
    context: CommandHandlerContext,
    options: TranslationBenchExplainerRunOptions,
): Promise<TranslationBenchExplainerCaseResult> {
    if (evalCase.explainer === undefined) {
        throw new Error(`Case '${evalCase.id}' has no explainer probes`);
    }
    const explainerName = options.explainerName ?? "v5";
    const explanationUsage = createTranslationBenchUsageAccumulator();
    const factory = new AgentCacheFactory();
    const cache = factory.create(
        explainerName,
        createSchemaInfoProvider(provider),
        { mergeMatchSets: false, cacheConflicts: false },
    );
    cache.model = options.model;
    const namespaceKeys = getTranslationBenchExplainerNamespaceKeys(cache, evalCase);
    let ruleCreated = false;
    let ruleText: string | undefined;
    let ruleJson: unknown;
    let explanationData: unknown;
    let explanationElapsedMs = 0;
    let error: string | undefined;
    let seedReplay = createTranslationBenchExplainerMiss(seedAsProbe(evalCase));
    let probes = evalCase.explainer.probes.map((probe) =>
        createTranslationBenchExplainerMiss(probe),
    );
    try {
        await cache.constructionStore.newCache();
        const seedHistory = toHistory(context, evalCase.seed.history);
        const actions = evalCase.seed.expectedActions.map((action) =>
            createExecutableAction(
                action.schemaName,
                action.actionName,
                action.parameters as Parameters<
                    typeof createExecutableAction
                >[2],
            ),
        );
        const seed = RequestAction.create(
            evalCase.seed.utterance,
            actions,
            seedHistory,
        );
        const built = await cache.processRequestAction(seed, true, {
            valueInRequest: evalCase.explainer.valueInRequest,
            noReferences: evalCase.explainer.noReferences,
        });
        void explanationUsage;
        explanationElapsedMs = built.explanationResult.elapsedMs;
        const explanation = built.explanationResult.explanation;
        if (explanation.success) {
            explanationData = explanation.data;
            if (explanation.construction !== undefined) {
                ruleText = explanation.construction.toString();
                ruleJson = explanation.construction.toJSON();
            }
        } else {
            error = explanation.message;
        }
        ruleCreated = built.constructionResult?.added === true;
        if (!ruleCreated && error === undefined) {
            error =
                built.constructionResult?.message ??
                "Explainer did not install a construction";
        }
        seedReplay = replayProbe(
            cache,
            seedAsProbe(evalCase),
            namespaceKeys,
            context,
        );
        probes = evalCase.explainer.probes.map((probe) =>
            replayProbe(cache, probe, namespaceKeys, context),
        );
    } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
        seedReplay = createTranslationBenchExplainerMiss(
            seedAsProbe(evalCase),
            error,
        );
        probes = evalCase.explainer.probes.map((probe) =>
            createTranslationBenchExplainerMiss(probe, error),
        );
    } finally {
        cache.constructionStore.clear();
    }
    const cacheReplayElapsedMs =
        seedReplay.elapsedMs +
        probes.reduce((sum, probe) => sum + probe.elapsedMs, 0);
    const summary = scoreTranslationBenchExplainer(
        probes,
        ruleCreated,
        seedReplay.score.passed,
    );
    const result: TranslationBenchExplainerCaseResult = {
        caseId: evalCase.id,
        model: options.model,
        explainerName,
        valueInRequest: evalCase.explainer.valueInRequest,
        noReferences: evalCase.explainer.noReferences,
        ruleCreated,
        ...(ruleText !== undefined ? { ruleText } : {}),
        ...(ruleJson !== undefined ? { ruleJson } : {}),
        ...(explanationData !== undefined ? { explanationData } : {}),
        explanationElapsedMs,
        explanationUsage: explanationUsage.finish(options.pricing),
        cacheReplayElapsedMs,
        seedReplay,
        probes,
        summary,
        ...(error !== undefined ? { error } : {}),
    };
    if (ruleCreated && options.judge !== undefined) {
        const rubricStarted = performance.now();
        const rubricUsage = createTranslationBenchUsageAccumulator();
        try {
            result.rubric = validateTranslationBenchRuleRubric(
                await options.judge.grade(
                    {
                        seed: {
                            utterance: evalCase.seed.utterance,
                            ...(evalCase.seed.history !== undefined
                                ? {
                                      history: structuredClone(
                                          evalCase.seed.history,
                                      ),
                                  }
                                : {}),
                            order: evalCase.seed.order,
                            lineage: structuredClone(evalCase.lineage),
                            ...(evalCase.dimensions !== undefined
                                ? {
                                      dimensions: structuredClone(
                                          evalCase.dimensions,
                                      ),
                                  }
                                : {}),
                            expectedActions: evalCase.seed.expectedActions,
                        },
                        ruleText: ruleText ?? "",
                        ruleJson,
                        seedReplay: structuredClone(seedReplay),
                        outcomes: probes,
                        summary: structuredClone(summary),
                    },
                    (usage) => rubricUsage.add(usage),
                ),
            );
        } catch (caught) {
            result.rubricError =
                caught instanceof Error ? caught.message : String(caught);
        }
        result.rubricModel = options.judge.model;
        result.rubricElapsedMs = performance.now() - rubricStarted;
        result.rubricUsage = rubricUsage.finish(options.judgePricing);
    }
    return result;
}

function parseRubricResponse(response: string): TranslationBenchRuleRubricInput {
    const start = response.indexOf("{");
    const end = response.lastIndexOf("}");
    if (start < 0 || end <= start) {
        throw new Error("Rule judge returned no JSON object");
    }
    return JSON.parse(
        response.slice(start, end + 1),
    ) as TranslationBenchRuleRubricInput;
}

export function formatTranslationBenchRuleJudgePrompt(
    input: TranslationBenchRuleJudgeInput,
) {
    return [
        {
            role: "system" as const,
            content:
                "Grade the installed action-cache rule. Return only JSON with correctness, coverage, overGeneralization, slotBinding, specificity (each 0 to 1), and a non-empty rationale. Every criterion is a quality score where 1 is best and 0 is worst. correctness measures correct action and parameter behavior on the seed and positive probes. coverage measures breadth across valid positive phrasings. overGeneralization measures resistance to false positives: 1 means no observed negative false fires; 0 means maximal over-generalization. slotBinding measures reliable action and parameter binding. specificity measures whether the rule separates intended requests from negatives without being so narrow that ordinary positives miss. Treat seedReplay, outcomes, and summary as authoritative; do not contradict their hits, passes, or counts. Judge the rule and deterministic replay outcomes, not the original translation.",
        },
        {
            role: "user" as const,
            content: JSON.stringify(input),
        },
    ];
}

export function createTranslationBenchRuleJudge(model: string): TranslationBenchRuleJudge {
    if (!model.trim()) throw new Error("Rule judge model is required");
    let chatModel: ChatModelWithStreaming | undefined;
    return {
        model,
        async grade(input, usageCallback) {
            const { openai } = await import("@typeagent/aiclient");
            chatModel ??= openai.createChatModel(
                model,
                { response_format: { type: "json_object" }, seed: 0 },
                undefined,
                ["translation-bench-rule-rubric"],
            );
            const response = await chatModel.complete(
                formatTranslationBenchRuleJudgePrompt(input),
                usageCallback,
            );
            if (!response.success) {
                throw new Error(response.message);
            }
            return parseRubricResponse(response.data);
        },
    };
}

/** Sum defined samples; skip holes so sparse usage cannot blank aggregates. */
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

function aggregateUsage(
    values: TranslationBenchUsage[],
): TranslationBenchExplainerAggregateUsage {
    return {
        promptTokens: sumKnown(values.map((value) => value.promptTokens)),
        completionTokens: sumKnown(
            values.map((value) => value.completionTokens),
        ),
        cachedTokens: sumKnown(values.map((value) => value.cachedTokens)),
        reasoningTokens: sumKnown(values.map((value) => value.reasoningTokens)),
        estimatedCostUsd: sumKnown(
            values.map((value) => value.estimatedCostUsd),
        ),
    };
}

export function aggregateTranslationBenchExplainerResults(
    results: TranslationBenchExplainerCaseResult[],
): TranslationBenchExplainerAggregate {
    const totalProbes = results.reduce(
        (sum, result) => sum + result.summary.totalProbes,
        0,
    );
    const passedProbes = results.reduce(
        (sum, result) => sum + result.summary.passedProbes,
        0,
    );
    const positiveRows = results.reduce(
        (sum, result) => sum + result.summary.positiveRows,
        0,
    );
    const positiveRowsPassed = results.reduce(
        (sum, result) => sum + result.summary.positiveRowsPassed,
        0,
    );
    const negativeRows = results.reduce(
        (sum, result) => sum + result.summary.negativeRows,
        0,
    );
    const negativeRowsFired = results.reduce(
        (sum, result) =>
            sum +
            result.probes.filter(
                (probe) => probe.kind === "negative" && probe.hit,
            ).length,
        0,
    );
    const expectedCount = results.reduce(
        (sum, result) => sum + result.summary.expectedCount,
        0,
    );
    const routed = results.reduce(
        (sum, result) => sum + result.summary.routed,
        0,
    );
    const paramMatches = results.reduce(
        (sum, result) => sum + result.summary.paramMatches,
        0,
    );
    const ruleCreatedCases = results.filter(
        (result) => result.ruleCreated,
    ).length;
    const seedReplayPassedCases = results.filter(
        (result) => result.seedReplay.score.passed,
    ).length;
    const rubrics = results.flatMap((result) =>
        result.rubric === undefined ? [] : [result.rubric],
    );
    const rubricCriterionSums = {
        correctness: rubrics.reduce(
            (sum, rubric) => sum + rubric.correctness,
            0,
        ),
        coverage: rubrics.reduce((sum, rubric) => sum + rubric.coverage, 0),
        overGeneralization: rubrics.reduce(
            (sum, rubric) => sum + rubric.overGeneralization,
            0,
        ),
        slotBinding: rubrics.reduce(
            (sum, rubric) => sum + rubric.slotBinding,
            0,
        ),
        specificity: rubrics.reduce(
            (sum, rubric) => sum + rubric.specificity,
            0,
        ),
    };
    const rubricScoreSum = rubrics.reduce(
        (sum, rubric) => sum + rubric.score,
        0,
    );
    const diagnostics = results.reduce<TranslationBenchDiagnosticCounts>(
        (total, result) => {
            for (const key of Object.keys(
                total,
            ) as (keyof TranslationBenchDiagnosticCounts)[]) {
                total[key] += result.summary.diagnostics[key];
            }
            return total;
        },
        createEmptyTranslationBenchDiagnosticCounts(),
    );
    return {
        totalCases: results.length,
        ruleCreatedCases,
        ruleCreationRate:
            results.length === 0 ? 0 : ruleCreatedCases / results.length,
        seedReplayPassedCases,
        seedReplayPassRate:
            results.length === 0 ? 0 : seedReplayPassedCases / results.length,
        totalProbes,
        passedProbes,
        passRate: totalProbes === 0 ? 0 : passedProbes / totalProbes,
        positiveRows,
        positiveRowsPassed,
        positivePassRate:
            positiveRows === 0 ? undefined : positiveRowsPassed / positiveRows,
        negativeRows,
        negativeRowsFired,
        expectedCount,
        routed,
        paramMatches,
        toolScore: expectedCount === 0 ? undefined : routed / expectedCount,
        paramScore: routed === 0 ? undefined : paramMatches / routed,
        falseNegativeRate:
            expectedCount === 0 ? undefined : 1 - routed / expectedCount,
        falsePositiveRate:
            negativeRows === 0 ? undefined : negativeRowsFired / negativeRows,
        diagnostics,
        cacheHitRows: results.reduce(
            (sum, result) => sum + result.summary.cacheHitRows,
            0,
        ),
        totalMatches: results.reduce(
            (sum, result) => sum + result.summary.totalMatches,
            0,
        ),
        collisionRows: results.reduce(
            (sum, result) => sum + result.summary.collisionRows,
            0,
        ),
        collisionCount: results.reduce(
            (sum, result) => sum + result.summary.collisionCount,
            0,
        ),
        errors: results.filter((result) => result.error !== undefined).length,
        rubricErrors: results.filter(
            (result) => result.rubricError !== undefined,
        ).length,
        rubricCases: rubrics.length,
        rubricScoreSum,
        rubricScore:
            rubrics.length === 0 ? undefined : rubricScoreSum / rubrics.length,
        rubricCriterionSums,
        rubricCriteria:
            rubrics.length === 0
                ? undefined
                : {
                      correctness:
                          rubricCriterionSums.correctness / rubrics.length,
                      coverage: rubricCriterionSums.coverage / rubrics.length,
                      overGeneralization:
                          rubricCriterionSums.overGeneralization /
                          rubrics.length,
                      slotBinding:
                          rubricCriterionSums.slotBinding / rubrics.length,
                      specificity:
                          rubricCriterionSums.specificity / rubrics.length,
                  },
        avgExplanationLatencyMs:
            results.length === 0
                ? 0
                : results.reduce(
                      (sum, result) => sum + result.explanationElapsedMs,
                      0,
                  ) / results.length,
        avgCacheReplayLatencyMs:
            results.length === 0
                ? 0
                : results.reduce(
                      (sum, result) => sum + result.cacheReplayElapsedMs,
                      0,
                  ) / results.length,
        explanationUsage: aggregateUsage(
            results.map((result) => result.explanationUsage),
        ),
        rubricUsage: aggregateUsage(
            results.map(
                (result) =>
                    result.rubricUsage ?? {
                        calls: 0,
                        promptTokens: undefined,
                        completionTokens: undefined,
                        cachedTokens: undefined,
                        reasoningTokens: undefined,
                        estimatedCostUsd: undefined,
                    },
            ),
        ),
    };
}
