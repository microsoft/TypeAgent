// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

import type { TranslationBenchTargetAction } from "./benchmark.js";
import type {
    TranslationBenchGeneratedCandidate,
    TranslationBenchReviewIssue,
    TranslationBenchReviewerDecision,
} from "./generationCandidate.js";

export const TRANSLATION_BENCH_NEGATIVE_KINDS = [
    "pure_refusal",
    "non_action_question",
    "missing_info",
    "unfair_contrastive",
    "unfair_imperative",
    "unfair_sibling_command",
    "unknown",
] as const;

export type TranslationBenchNegativeKind =
    (typeof TRANSLATION_BENCH_NEGATIVE_KINDS)[number];

const FAIR_KINDS = new Set<TranslationBenchNegativeKind>([
    "pure_refusal",
    "non_action_question",
    "missing_info",
]);

export const translationBenchNegativeAssessmentSchema = z
    .object({
        path: z.string().trim().min(1),
        kind: z.enum(TRANSLATION_BENCH_NEGATIVE_KINDS),
        fairEmptyGold: z.boolean(),
        reason: z.string().trim().min(1),
    })
    .strict();

export const translationBenchNegativeAssessmentsSchema = z.array(
    translationBenchNegativeAssessmentSchema,
);

export type TranslationBenchNegativeFairnessAssessment = z.infer<
    typeof translationBenchNegativeAssessmentSchema
>;

export interface TranslationBenchNegativeFairnessResult {
    ok: boolean;
    kind: TranslationBenchNegativeKind;
    path: string;
    utterance: string;
    message?: string;
    suggestedFix?: string;
}

export const TRANSLATION_BENCH_NEGATIVE_FAIRNESS_RULE =
    "Empty-gold negatives must be fair under zero-action scoring: pure refusal " +
    "of the target, non-action status/howto question, or missing-info " +
    "clarification. Never use contrastive adjacent commands, refuse-then-alternate " +
    "forms, capability questions that still solicit an action, or any imperative " +
    "a correct translator would map to another tool.";

export function isFairTranslationBenchNegativeKind(
    kind: TranslationBenchNegativeKind,
): boolean {
    return FAIR_KINDS.has(kind);
}

export function translationBenchNegativeFairnessRewriteHint(
    target: TranslationBenchTargetAction,
): string {
    const key = `${target.schemaName}.${target.actionName}`;
    return (
        `Rewrite as a pure refusal of ${key}, a non-action status/howto ` +
        `question, or a missing-info clarification. No contrastive or ` +
        `refuse-then-alternate empty gold.`
    );
}

export function translationBenchNegativeAssessmentsJsonSchema(): Record<
    string,
    unknown
> {
    const { $schema: _schema, ...schema } = z.toJSONSchema(
        translationBenchNegativeAssessmentsSchema,
    );
    void _schema;
    return schema;
}

export function parseTranslationBenchNegativeFairnessAssessments(
    value: unknown,
): TranslationBenchNegativeFairnessAssessment[] {
    const parsed = translationBenchNegativeAssessmentsSchema.safeParse(value);
    if (!parsed.success) {
        const detail = parsed.error.issues
            .map((i) => `${i.path.join(".") || "$"}: ${i.message}`)
            .join("; ");
        throw new Error(`negativeAssessments invalid: ${detail}`);
    }
    return parsed.data;
}

export function checkTranslationBenchNegativeFairnessAssessment(
    assessment: TranslationBenchNegativeFairnessAssessment,
    utterance: string,
    target: TranslationBenchTargetAction,
): TranslationBenchNegativeFairnessResult {
    const suggestedFix = translationBenchNegativeFairnessRewriteHint(target);
    const fairKind = FAIR_KINDS.has(assessment.kind);
    if (assessment.fairEmptyGold && fairKind) {
        return {
            ok: true,
            kind: assessment.kind,
            path: assessment.path,
            utterance,
        };
    }
    const targetKey = `${target.schemaName}.${target.actionName}`;
    const message =
        assessment.fairEmptyGold && !fairKind
            ? `fairEmptyGold=true with unfair kind ${assessment.kind} for ${targetKey}: ${assessment.reason}`
            : assessment.reason ||
              `Negative is not a fair empty-gold case for ${targetKey}.`;
    return {
        ok: false,
        kind: fairKind ? "unknown" : assessment.kind,
        path: assessment.path,
        utterance,
        message,
        suggestedFix,
    };
}

function negativeCases(candidate: TranslationBenchGeneratedCandidate): {
    path: string;
    utterance: string;
}[] {
    return candidate.genCases.flatMap((genCase, index) =>
        genCase.role === "negative"
            ? [
                  {
                      path: `$.genCases[${index}].utterance`,
                      utterance: genCase.utterance,
                  },
              ]
            : [],
    );
}

function issue(
    path: string,
    message: string,
    suggestedFix: string,
): TranslationBenchReviewIssue {
    return { code: "BAD_NEGATIVE", path, message, suggestedFix };
}

export function checkTranslationBenchCandidateNegativeFairness(
    candidate: TranslationBenchGeneratedCandidate,
    target: TranslationBenchTargetAction,
    assessments: readonly TranslationBenchNegativeFairnessAssessment[],
): TranslationBenchReviewIssue[] {
    const negatives = negativeCases(candidate);
    const fix = translationBenchNegativeFairnessRewriteHint(target);

    if (negatives.length === 0) {
        return assessments.length === 0
            ? []
            : [
                  issue(
                      "$.negativeAssessments",
                      "negativeAssessments is non-empty but candidate has no negatives",
                      "Emit negativeAssessments: [].",
                  ),
              ];
    }

    if (assessments.length !== negatives.length) {
        return [
            issue(
                "$.negativeAssessments",
                `Expected ${negatives.length} negativeAssessments, got ${assessments.length}`,
                "Emit exactly one assessment per negative genCase.",
            ),
        ];
    }

    const issues: TranslationBenchReviewIssue[] = [];
    for (const [i, neg] of negatives.entries()) {
        const result = checkTranslationBenchNegativeFairnessAssessment(
            assessments[i]!,
            neg.utterance,
            target,
        );
        if (!result.ok) {
            issues.push(issue(neg.path, result.message!, result.suggestedFix ?? fix));
        }
    }
    return issues;
}

function issueKey(i: TranslationBenchReviewIssue): string {
    return `${i.code}\0${i.path}\0${i.message}`;
}

export function applyTranslationBenchNegativeFairnessIssues(
    decision: TranslationBenchReviewerDecision,
    fairnessIssues: readonly TranslationBenchReviewIssue[],
): TranslationBenchReviewerDecision {
    if (fairnessIssues.length === 0) return decision;

    const seen = new Set(decision.issues.map(issueKey));
    const issues = [
        ...decision.issues,
        ...fairnessIssues.filter((i) => !seen.has(issueKey(i))),
    ];

    return {
        ...decision,
        decision: "reject",
        issues,
        scores: {
            ...decision.scores,
            negativeQuality: Math.min(decision.scores.negativeQuality, 0.4),
        },
        summary:
            decision.decision === "approve"
                ? `Rejected: empty-gold negative fairness failed (${fairnessIssues.length} issue(s))`
                : decision.summary,
    };
}
