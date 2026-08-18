// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TranslationBenchBenchmarkAction } from "./benchmark.js";
import type {
    TranslationBenchGeneratedCandidate,
    TranslationBenchReviewIssue,
} from "./generationCandidate.js";

export interface TranslationBenchAmbiguityProbeAction {
    schemaName: string;
    actionName: string;
    parameters?: Record<string, unknown>;
}

export interface TranslationBenchAmbiguityProbeObservation {
    model: string;
    actions: TranslationBenchAmbiguityProbeAction[];
    error?: string;
}

export interface TranslationBenchAmbiguityProbeRequest {
    model: string;
    utterance: string;
    history?: unknown;
    activeSchemas: readonly string[];
}

export const TRANSLATION_BENCH_DEFAULT_AMBIGUITY_PROBE_MODELS = [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
] as const;

export interface TranslationBenchAmbiguityProbeTranslator {
    models: readonly string[];
    translate(
        request: TranslationBenchAmbiguityProbeRequest,
    ): Promise<TranslationBenchAmbiguityProbeObservation>;
}

export type TranslationBenchAmbiguityAgreement =
    | "unanimous_gold"
    | "unanimous_other"
    | "split"
    | "all_errors";

export interface TranslationBenchAmbiguityProbeCaseResult {
    path: string;
    utterance: string;
    expectedActions: TranslationBenchBenchmarkAction[];
    observations: TranslationBenchAmbiguityProbeObservation[];
    agreement: TranslationBenchAmbiguityAgreement;
    routes: string[];
}

export interface TranslationBenchAmbiguityJudgeDecision {
    candidateHash: string;
    decision: "approve" | "reject";
    ambiguous: boolean;
    issues: TranslationBenchReviewIssue[];
    summary: string;
}

export interface TranslationBenchAmbiguityCheckResult {
    stage: "ambiguity_probe";
    passed: boolean;
    cases: TranslationBenchAmbiguityProbeCaseResult[];
    judge?: {
        decision: TranslationBenchAmbiguityJudgeDecision;
        prompt: string;
        completionText: string;
    };
    issues: TranslationBenchReviewIssue[];
}

function routeKey(
    actions: readonly TranslationBenchAmbiguityProbeAction[],
): string {
    if (actions.length === 0) return "(empty)";
    return actions
        .map((a) => `${a.schemaName}.${a.actionName}`)
        .sort()
        .join("|");
}

function goldRouteKey(
    expected: readonly TranslationBenchBenchmarkAction[],
): string {
    return routeKey(
        expected.map((a) => ({
            schemaName: a.schemaName,
            actionName: a.actionName,
        })),
    );
}

export function classifyTranslationBenchAmbiguityAgreement(
    expected: readonly TranslationBenchBenchmarkAction[],
    observations: readonly TranslationBenchAmbiguityProbeObservation[],
): {
    agreement: TranslationBenchAmbiguityAgreement;
    routes: string[];
} {
    const gold = goldRouteKey(expected);
    const okRoutes: string[] = [];
    for (const obs of observations) {
        if (obs.error !== undefined && obs.error.trim().length > 0) {
            continue;
        }
        okRoutes.push(routeKey(obs.actions));
    }
    const unique = [...new Set(okRoutes)].sort();
    if (okRoutes.length === 0) {
        return { agreement: "all_errors", routes: unique };
    }
    if (unique.length > 1) {
        return { agreement: "split", routes: unique };
    }
    const only = unique[0]!;
    if (only === gold) {
        return { agreement: "unanimous_gold", routes: unique };
    }
    return { agreement: "unanimous_other", routes: unique };
}

export function listTranslationBenchAmbiguityProbeTargets(
    candidate: TranslationBenchGeneratedCandidate,
): Array<{
    path: string;
    utterance: string;
    history?: unknown;
    expectedActions: TranslationBenchBenchmarkAction[];
}> {
    const out: Array<{
        path: string;
        utterance: string;
        history?: unknown;
        expectedActions: TranslationBenchBenchmarkAction[];
    }> = [
        {
            path: "$.seed.utterance",
            utterance: candidate.seed.utterance,
            ...(candidate.seed.history !== undefined
                ? { history: candidate.seed.history }
                : {}),
            expectedActions: candidate.seed.expectedActions,
        },
    ];
    candidate.genCases.forEach((genCase, index) => {
        if (genCase.role !== "positive") return;
        out.push({
            path: `$.genCases[${index}].utterance`,
            utterance: genCase.utterance,
            ...(genCase.history !== undefined
                ? { history: genCase.history }
                : {}),
            expectedActions: genCase.expectedActions,
        });
    });
    return out;
}

export async function probeTranslationBenchAmbiguityCases(options: {
    candidate: TranslationBenchGeneratedCandidate;
    activeSchemas: readonly string[];
    translator: TranslationBenchAmbiguityProbeTranslator;
}): Promise<TranslationBenchAmbiguityProbeCaseResult[]> {
    const models = options.translator.models;
    if (models.length < 2) {
        throw new Error(
            "ambiguity probe requires at least 2 models (got " +
                models.length +
                ")",
        );
    }
    const targets = listTranslationBenchAmbiguityProbeTargets(
        options.candidate,
    );
    const cases: TranslationBenchAmbiguityProbeCaseResult[] = [];
    for (const target of targets) {
        const observations = await Promise.all(
            models.map((model) =>
                options.translator.translate({
                    model,
                    utterance: target.utterance,
                    ...(target.history !== undefined
                        ? { history: target.history }
                        : {}),
                    activeSchemas: options.activeSchemas,
                }),
            ),
        );
        const ordered = models.map((model) => {
            const hit = observations.find((o) => o.model === model);
            return (
                hit ?? {
                    model,
                    actions: [],
                    error: `Probe translator returned no observation for model '${model}'`,
                }
            );
        });
        const { agreement, routes } =
            classifyTranslationBenchAmbiguityAgreement(
                target.expectedActions,
                ordered,
            );
        cases.push({
            path: target.path,
            utterance: target.utterance,
            expectedActions: target.expectedActions,
            observations: ordered,
            agreement,
            routes,
        });
    }
    return cases;
}

export function translationBenchAmbiguityCasesClear(
    cases: readonly TranslationBenchAmbiguityProbeCaseResult[],
): boolean {
    return (
        cases.length > 0 && cases.every((c) => c.agreement === "unanimous_gold")
    );
}
