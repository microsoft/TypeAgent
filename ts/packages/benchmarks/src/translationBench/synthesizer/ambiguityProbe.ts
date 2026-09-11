// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CompletionJsonSchema } from "@typeagent/aiclient";

import type {
    TranslationBenchBenchmarkAction,
    TranslationBenchTargetAction,
} from "./benchmark.js";
import type {
    TranslationBenchGeneratedCandidate,
    TranslationBenchReviewIssue,
} from "./generationCandidate.js";
import type { TranslationBenchGenerationLlm } from "./datasetGenerator.js";
import {
    renderTranslationBenchPromptTemplate,
    type TranslationBenchQualityVerifierPromptPack,
} from "./synthesizerPrompts.js";
import { parseTranslationBenchDatasetBuilderJson } from "./benchmark.js";
import {
    findTranslationBenchConfusableSiblings,
    summarizeTranslationBenchConfusableSiblings,
} from "./utteranceDisambiguation.js";
import type { TranslationBenchBenchmarkSchema } from "./benchmark.js";

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
    let errors = 0;
    for (const obs of observations) {
        if (obs.error !== undefined && obs.error.trim().length > 0) {
            errors += 1;
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
            models.map(async (model) => {
                try {
                    return await options.translator.translate({
                        model,
                        utterance: target.utterance,
                        ...(target.history !== undefined
                            ? { history: target.history }
                            : {}),
                        activeSchemas: options.activeSchemas,
                    });
                } catch (error) {
                    return {
                        model,
                        actions: [],
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    };
                }
            }),
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

export function buildTranslationBenchAmbiguityJudgePrompt(
    pack: TranslationBenchQualityVerifierPromptPack,
    options: {
        candidateHash: string;
        targetAction: TranslationBenchTargetAction;
        catalog: readonly TranslationBenchBenchmarkSchema[];
        cases: readonly TranslationBenchAmbiguityProbeCaseResult[];
    },
): string {
    const confusableSiblings = findTranslationBenchConfusableSiblings(
        options.targetAction,
        options.catalog,
    );
    const payload = {
        candidateHash: options.candidateHash,
        targetAction: options.targetAction,
        confusableSiblings: summarizeTranslationBenchConfusableSiblings(
            options.targetAction,
            confusableSiblings,
        ),
        rule:
            "Reject when the positive utterance is ambiguous: multiple tools are " +
            "equally plausible, or independent translators from different models " +
            "split on route, or all translators agree on a different route than " +
            "gold. Approve only when gold is the unique correct reading and any " +
            "disagreement is clearly translator error (not genuine double meaning).",
        probeModelCount: options.cases[0]?.observations.length ?? 0,
        cases: options.cases.map((c) => ({
            path: c.path,
            utterance: c.utterance,
            expectedRoute: goldRouteKey(c.expectedActions),
            expectedActions: c.expectedActions,
            agreement: c.agreement,
            observedRoutes: c.routes,
            observations: c.observations.map((o, index) => ({
                probe: `probe-${index + 1}`,
                route: o.error ? `(error)` : routeKey(o.actions),
                actions: o.actions,
                ...(o.error !== undefined ? { error: o.error } : {}),
            })),
        })),
    };
    return renderTranslationBenchPromptTemplate(pack.ambiguityProbe.template, {
        candidate_hash: options.candidateHash,
        issue_codes: pack.ambiguityProbe.issueCodes.join(", "),
        probe_model_count: String(payload.probeModelCount || 3),
        payload_json: JSON.stringify(payload),
    });
}

export function ambiguityJudgeJsonSchema(
    candidateHash: string,
    issueCodes: string[],
): CompletionJsonSchema {
    return {
        name: "translation_bench_quality_verifier_ambiguity",
        description:
            "Multi-model ambiguity judge for one synthesizer candidate",
        schema: {
            type: "object",
            properties: {
                candidateHash: { const: candidateHash },
                decision: { type: "string", enum: ["approve", "reject"] },
                ambiguous: { type: "boolean" },
                issues: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            code: { type: "string", enum: issueCodes },
                            path: { type: "string", minLength: 1 },
                            message: { type: "string", minLength: 1 },
                            suggestedFix: { type: "string", minLength: 1 },
                        },
                        required: ["code", "path", "message", "suggestedFix"],
                        additionalProperties: false,
                    },
                },
                summary: { type: "string", minLength: 1 },
            },
            required: [
                "candidateHash",
                "decision",
                "ambiguous",
                "issues",
                "summary",
            ],
            additionalProperties: false,
        },
    };
}

const issueCodeSet = new Set([
    "ANCHOR_DRIFT",
    "WRONG_ACTION",
    "INVALID_PARAMETERS",
    "AMBIGUOUS_INTENT",
    "DUPLICATE_CASE",
    "WEAK_DIVERSITY",
    "BAD_NEGATIVE",
    "BAD_HISTORY",
    "UNNATURAL_TEXT",
    "OTHER",
]);

export function parseTranslationBenchAmbiguityJudgeDecision(
    raw: unknown,
    candidateHash: string,
): TranslationBenchAmbiguityJudgeDecision {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Ambiguity judge response must be a JSON object");
    }
    const obj = raw as Record<string, unknown>;
    if (obj.candidateHash !== candidateHash) {
        throw new Error(
            `Ambiguity judge candidateHash mismatch (got ${JSON.stringify(obj.candidateHash)})`,
        );
    }
    if (obj.decision !== "approve" && obj.decision !== "reject") {
        throw new Error("Ambiguity judge decision must be approve|reject");
    }
    if (typeof obj.ambiguous !== "boolean") {
        throw new Error("Ambiguity judge ambiguous must be boolean");
    }
    if (typeof obj.summary !== "string" || obj.summary.trim().length === 0) {
        throw new Error("Ambiguity judge summary must be a non-empty string");
    }
    if (!Array.isArray(obj.issues)) {
        throw new Error("Ambiguity judge issues must be an array");
    }
    const issues: TranslationBenchReviewIssue[] = obj.issues.map((item, i) => {
        if (item === null || typeof item !== "object" || Array.isArray(item)) {
            throw new Error(`Ambiguity judge issues[${i}] must be an object`);
        }
        const issue = item as Record<string, unknown>;
        const code = issue.code;
        if (typeof code !== "string" || !issueCodeSet.has(code)) {
            throw new Error(`Ambiguity judge issues[${i}].code is invalid`);
        }
        for (const field of ["path", "message", "suggestedFix"] as const) {
            if (
                typeof issue[field] !== "string" ||
                (issue[field] as string).trim().length === 0
            ) {
                throw new Error(
                    `Ambiguity judge issues[${i}].${field} must be non-empty`,
                );
            }
        }
        return {
            code: code as TranslationBenchReviewIssue["code"],
            path: issue.path as string,
            message: issue.message as string,
            suggestedFix: issue.suggestedFix as string,
        };
    });

    let decision = obj.decision as "approve" | "reject";
    let ambiguous = obj.ambiguous;
    if (ambiguous && decision === "approve") {
        decision = "reject";
    }
    if (decision === "approve" && issues.length > 0) {
        decision = "reject";
    }
    if (decision === "reject" && issues.length === 0) {
        issues.push({
            code: "AMBIGUOUS_INTENT",
            path: "$",
            message:
                "Ambiguity judge rejected without issues; treating as AMBIGUOUS_INTENT",
            suggestedFix:
                "Rewrite positives so independent translators unanimously route to the gold action",
        });
        ambiguous = true;
    }

    return {
        candidateHash,
        decision,
        ambiguous,
        issues,
        summary: obj.summary as string,
    };
}

export function deterministicAmbiguityIssues(
    cases: readonly TranslationBenchAmbiguityProbeCaseResult[],
): TranslationBenchReviewIssue[] {
    const issues: TranslationBenchReviewIssue[] = [];
    for (const c of cases) {
        if (c.agreement === "unanimous_gold") continue;
        if (c.agreement === "split") {
            issues.push({
                code: "AMBIGUOUS_INTENT",
                path: c.path,
                message:
                    `Multi-model probe split on routes for '${c.utterance.slice(0, 80)}' ` +
                    `(routes: ${c.routes.join(" vs ")}). Gold is not uniquely identified.`,
                suggestedFix:
                    "Rewrite so all probe translators select the gold action.",
            });
            continue;
        }
        if (c.agreement === "unanimous_other") {
            issues.push({
                code: "AMBIGUOUS_INTENT",
                path: c.path,
                message:
                    `All probe models agreed on '${c.routes[0] ?? "?"}' instead of gold ` +
                    `'${goldRouteKey(c.expectedActions)}' for '${c.utterance.slice(0, 80)}'.`,
                suggestedFix:
                    "Either fix gold to the model-agreed action or rewrite the utterance so gold is the only reading.",
            });
            continue;
        }
        issues.push({
            code: "OTHER",
            path: c.path,
            message: `All ambiguity probe models failed to translate '${c.utterance.slice(0, 80)}'`,
            suggestedFix:
                "Retry generation; if probes keep failing, check translator wiring.",
        });
    }
    return issues;
}

export async function runTranslationBenchAmbiguityProbe(options: {
    pack: TranslationBenchQualityVerifierPromptPack;
    candidate: TranslationBenchGeneratedCandidate;
    candidateHash: string;
    targetAction: TranslationBenchTargetAction;
    activeSchemas: readonly string[];
    catalog: readonly TranslationBenchBenchmarkSchema[];
    translator: TranslationBenchAmbiguityProbeTranslator;
    judgeLlm: TranslationBenchGenerationLlm;
}): Promise<TranslationBenchAmbiguityCheckResult> {
    let cases: TranslationBenchAmbiguityProbeCaseResult[];
    try {
        cases = await probeTranslationBenchAmbiguityCases({
            candidate: options.candidate,
            activeSchemas: options.activeSchemas,
            translator: options.translator,
        });
    } catch (error) {
        const issue: TranslationBenchReviewIssue = {
            code: "OTHER",
            path: "$quality_verifier.ambiguity_probe",
            message: `Ambiguity probe failed: ${
                error instanceof Error ? error.message : String(error)
            }`,
            suggestedFix: "Fix multi-model translator wiring and regenerate.",
        };
        return {
            stage: "ambiguity_probe",
            passed: false,
            cases: [],
            issues: [issue],
        };
    }

    if (cases.length === 0) {
        return {
            stage: "ambiguity_probe",
            passed: false,
            cases,
            issues: [
                {
                    code: "OTHER",
                    path: "$",
                    message: "Ambiguity probe found no positive utterances",
                    suggestedFix: "Ensure seed is a positive gold label",
                },
            ],
        };
    }

    if (translationBenchAmbiguityCasesClear(cases)) {
        return {
            stage: "ambiguity_probe",
            passed: true,
            cases,
            issues: [],
        };
    }

    const detIssues = deterministicAmbiguityIssues(cases);
    const prompt = buildTranslationBenchAmbiguityJudgePrompt(options.pack, {
        candidateHash: options.candidateHash,
        targetAction: options.targetAction,
        catalog: options.catalog,
        cases,
    });

    try {
        const completion = await options.judgeLlm.complete(
            prompt,
            ambiguityJudgeJsonSchema(
                options.candidateHash,
                options.pack.ambiguityProbe.issueCodes,
            ),
        );
        const text =
            typeof completion === "string" ? completion : completion.text;
        const raw = parseTranslationBenchDatasetBuilderJson(
            text,
            "Translation-bench quality verifier (ambiguity probe)",
        );
        const decision = parseTranslationBenchAmbiguityJudgeDecision(
            raw,
            options.candidateHash,
        );

        const mergedIssues =
            decision.decision === "approve" && detIssues.length > 0
                ? detIssues
                : mergeIssues(detIssues, decision.issues);
        const passed =
            decision.decision === "approve" && mergedIssues.length === 0;

        return {
            stage: "ambiguity_probe",
            passed,
            cases,
            judge: {
                decision: {
                    ...decision,
                    decision: passed ? "approve" : "reject",
                    ambiguous: !passed,
                    issues: passed ? [] : mergedIssues,
                },
                prompt,
                completionText: text,
            },
            issues: passed ? [] : mergedIssues,
        };
    } catch (error) {
        const judgeFail: TranslationBenchReviewIssue = {
            code: "OTHER",
            path: "$quality_verifier.ambiguity_probe",
            message: `Ambiguity judge response invalid: ${
                error instanceof Error ? error.message : String(error)
            }`,
            suggestedFix:
                "Regenerate; judge must return approve/reject JSON bound to candidateHash.",
        };
        const issues = detIssues.length > 0 ? detIssues : [judgeFail];
        return {
            stage: "ambiguity_probe",
            passed: false,
            cases,
            judge: {
                decision: {
                    candidateHash: options.candidateHash,
                    decision: "reject",
                    ambiguous: true,
                    issues,
                    summary: judgeFail.message,
                },
                prompt,
                completionText: "",
            },
            issues,
        };
    }
}

function mergeIssues(
    a: readonly TranslationBenchReviewIssue[],
    b: readonly TranslationBenchReviewIssue[],
): TranslationBenchReviewIssue[] {
    const seen = new Set<string>();
    const out: TranslationBenchReviewIssue[] = [];
    for (const issue of [...a, ...b]) {
        const key = `${issue.code}|${issue.path}|${issue.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(issue);
    }
    return out;
}
