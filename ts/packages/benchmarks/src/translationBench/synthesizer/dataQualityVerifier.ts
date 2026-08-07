// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CompletionJsonSchema } from "@typeagent/aiclient";

import type {
    TranslationBenchGeneratedCandidate,
    TranslationBenchGenerationLlm,
    TranslationBenchGenerationQualityLoopOptions,
    TranslationBenchReviewIssue,
    TranslationBenchReviewerDecision,
    TranslationBenchReviewerScores,
} from "./datasetGenerator.js";
import {
    parseTranslationBenchGeneratedCandidate,
    parseTranslationBenchReviewerDecision,
} from "./datasetGenerator.js";
import {
    computeTranslationBenchCanonicalJsonHash,
    parseTranslationBenchDatasetBuilderJson,
} from "./benchmark.js";
import {
    loadTranslationBenchQualityVerifierPromptPack,
    renderTranslationBenchPromptTemplate,
    type TranslationBenchQualityVerifierPromptPack,
} from "./synthesizerPrompts.js";

export type TranslationBenchQualityStage =
    | "format_checker"
    | "semantic_checker";

export interface TranslationBenchFormatCheckResult {
    stage: "format_checker";
    passed: boolean;
    issues: TranslationBenchReviewIssue[];
    candidate?: TranslationBenchGeneratedCandidate;
}

export interface TranslationBenchSemanticCheckResult {
    stage: "semantic_checker";
    passed: boolean;
    decision: TranslationBenchReviewerDecision;
    prompt: string;
    completionText: string;
}

export interface TranslationBenchQualityVerifyResult {
    accepted: boolean;
    format: TranslationBenchFormatCheckResult;
    semantic?: TranslationBenchSemanticCheckResult;
    feedback: TranslationBenchReviewIssue[];
}

export interface TranslationBenchQualityVerifierOptions {
    synthesizerOutput: unknown;
    loop: TranslationBenchGenerationQualityLoopOptions;
    candidateHash: string;
    candidate?: TranslationBenchGeneratedCandidate;
    semanticLlm: TranslationBenchGenerationLlm;
    promptsDir?: string;
    promptPack?: TranslationBenchQualityVerifierPromptPack;
}

const rejectedScores: TranslationBenchReviewerScores = {
    anchorFidelity: 0,
    groundTruthCorrectness: 0,
    naturalness: 0,
    generalizationDiversity: 0,
    negativeQuality: 0,
    historyCoherence: 0,
};

function formatIssue(error: unknown): TranslationBenchReviewIssue {
    return {
        code: "INVALID_PARAMETERS",
        path: "$",
        message: error instanceof Error ? error.message : String(error),
        suggestedFix:
            "Regenerate the complete row and satisfy every deterministic schema and count invariant.",
    };
}

function semanticValidationIssue(error: unknown): TranslationBenchReviewIssue {
    return {
        code: "OTHER",
        path: "$quality_verifier.semantic_checker",
        message: `Semantic checker response failed validation: ${
            error instanceof Error ? error.message : String(error)
        }`,
        suggestedFix:
            "Regenerate the row and run a new independent quality verification bound to the exact candidate hash.",
    };
}

export function runTranslationBenchFormatChecker(
    synthesizerOutput: unknown,
    loop: TranslationBenchGenerationQualityLoopOptions,
    preParsed?: TranslationBenchGeneratedCandidate,
): TranslationBenchFormatCheckResult {
    try {
        const candidate = parseTranslationBenchGeneratedCandidate(
            synthesizerOutput,
            {
                targetAction: loop.targetAction,
                schema: loop.schema,
                genCaseCount: loop.genCaseCount,
                ...(loop.forbiddenUtterances !== undefined
                    ? { forbiddenUtterances: loop.forbiddenUtterances }
                    : {}),
            },
        );
        // Prefer re-parsed candidate; reject preParsed that drifts from raw JSON.
        if (preParsed !== undefined) {
            const fromRaw = computeTranslationBenchCanonicalJsonHash(candidate);
            const fromPre = computeTranslationBenchCanonicalJsonHash(preParsed);
            if (fromRaw !== fromPre) {
                return {
                    stage: "format_checker",
                    passed: false,
                    issues: [
                        {
                            code: "INVALID_PARAMETERS",
                            path: "$",
                            message:
                                "preParsed candidate does not match synthesizerOutput",
                            suggestedFix:
                                "Pass the candidate produced by parsing synthesizerOutput only",
                        },
                    ],
                };
            }
        }
        return {
            stage: "format_checker",
            passed: true,
            issues: [],
            candidate,
        };
    } catch (error) {
        return {
            stage: "format_checker",
            passed: false,
            issues: [formatIssue(error)],
        };
    }
}

export function buildTranslationBenchSemanticCheckerPrompt(
    pack: TranslationBenchQualityVerifierPromptPack,
    loop: TranslationBenchGenerationQualityLoopOptions,
    candidate: TranslationBenchGeneratedCandidate,
    candidateHash: string,
): string {
    const threshold = pack.semanticChecker.approveScoreThreshold;
    const payload = {
        candidateHash,
        immutableContext: {
            anchor: {
                candidateId: loop.anchor.candidateId,
                utterance: loop.anchor.utterance,
                ...(loop.anchor.history !== undefined
                    ? { history: loop.anchor.history }
                    : {}),
                sourceCalls: loop.anchor.sourceCalls,
            },
            targetAction: loop.targetAction,
            targetTool: loop.schema.tools.find(
                (tool) => tool.function.name === loop.targetAction.actionName,
            ),
            activeSchemas: loop.activeSchemas,
        },
        candidate,
        formatCheckerChecks: pack.formatChecker.checks,
    };
    return renderTranslationBenchPromptTemplate(pack.semanticChecker.template, {
        approve_score_threshold: threshold,
        issue_codes: pack.semanticChecker.issueCodes.join(", "),
        candidate_hash: candidateHash,
        payload_json: JSON.stringify(payload),
    });
}

export function semanticCheckerJsonSchema(
    candidateHash: string,
    issueCodes: string[],
): CompletionJsonSchema {
    const score = { type: "number", minimum: 0, maximum: 1 };
    return {
        name: "translation_bench_quality_verifier_semantic",
        description:
            "Independent data-quality decision for one synthesizer candidate",
        schema: {
            type: "object",
            properties: {
                candidateHash: { const: candidateHash },
                decision: { type: "string", enum: ["approve", "reject"] },
                scores: {
                    type: "object",
                    properties: {
                        anchorFidelity: score,
                        groundTruthCorrectness: score,
                        naturalness: score,
                        generalizationDiversity: score,
                        negativeQuality: score,
                        historyCoherence: score,
                    },
                    required: [
                        "anchorFidelity",
                        "groundTruthCorrectness",
                        "naturalness",
                        "generalizationDiversity",
                        "negativeQuality",
                        "historyCoherence",
                    ],
                    additionalProperties: false,
                },
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
                "scores",
                "issues",
                "summary",
            ],
            additionalProperties: false,
        },
    };
}

function enforceApproveThreshold(
    decision: TranslationBenchReviewerDecision,
    threshold: number,
): TranslationBenchReviewerDecision {
    if (decision.decision !== "approve") return decision;
    const scores = decision.scores;
    const below = (
        Object.entries(scores) as [
            keyof TranslationBenchReviewerScores,
            number,
        ][]
    ).filter(([, value]) => value < threshold);
    if (below.length === 0 && decision.issues.length === 0) return decision;
    return {
        ...decision,
        decision: "reject",
        issues:
            decision.issues.length > 0
                ? decision.issues
                : below.map(([name, value]) => ({
                      code: "OTHER" as const,
                      path: `$.scores.${name}`,
                      message: `Score ${name}=${value} is below approve threshold ${threshold}`,
                      suggestedFix:
                          "Improve the labeled row so every quality score meets the threshold.",
                  })),
        summary:
            decision.issues.length > 0
                ? decision.summary
                : `Rejected: scores below threshold ${threshold}`,
    };
}

export async function runTranslationBenchSemanticChecker(options: {
    pack: TranslationBenchQualityVerifierPromptPack;
    loop: TranslationBenchGenerationQualityLoopOptions;
    candidate: TranslationBenchGeneratedCandidate;
    candidateHash: string;
    llm: TranslationBenchGenerationLlm;
}): Promise<TranslationBenchSemanticCheckResult> {
    const prompt = buildTranslationBenchSemanticCheckerPrompt(
        options.pack,
        options.loop,
        options.candidate,
        options.candidateHash,
    );
    const completion = await options.llm.complete(
        prompt,
        semanticCheckerJsonSchema(
            options.candidateHash,
            options.pack.semanticChecker.issueCodes,
        ),
    );
    const text = typeof completion === "string" ? completion : completion.text;
    try {
        const parsed = parseTranslationBenchReviewerDecision(
            parseTranslationBenchDatasetBuilderJson(
                text,
                "Translation-bench quality verifier (semantic)",
            ),
            options.candidateHash,
        );
        const decision = enforceApproveThreshold(
            parsed,
            options.pack.semanticChecker.approveScoreThreshold,
        );
        return {
            stage: "semantic_checker",
            passed: decision.decision === "approve",
            decision,
            prompt,
            completionText: text,
        };
    } catch (error) {
        const issue = semanticValidationIssue(error);
        return {
            stage: "semantic_checker",
            passed: false,
            decision: {
                candidateHash: options.candidateHash,
                decision: "reject",
                scores: rejectedScores,
                issues: [issue],
                summary:
                    "Semantic checker response was invalid and cannot approve the row",
            },
            prompt,
            completionText: text,
        };
    }
}

export async function runTranslationBenchDataQualityVerifier(
    options: TranslationBenchQualityVerifierOptions,
): Promise<TranslationBenchQualityVerifyResult> {
    const pack =
        options.promptPack ??
        loadTranslationBenchQualityVerifierPromptPack(options.promptsDir);

    const format = runTranslationBenchFormatChecker(
        options.synthesizerOutput,
        options.loop,
        options.candidate,
    );
    if (!format.passed || format.candidate === undefined) {
        return {
            accepted: false,
            format,
            feedback: format.issues,
        };
    }

    // Pack load already requires require_semantic_approve=true.
    const semantic = await runTranslationBenchSemanticChecker({
        pack,
        loop: options.loop,
        candidate: format.candidate,
        candidateHash: options.candidateHash,
        llm: options.semanticLlm,
    });

    return {
        accepted: semantic.passed,
        format,
        semantic,
        feedback: semantic.passed ? [] : semantic.decision.issues,
    };
}
