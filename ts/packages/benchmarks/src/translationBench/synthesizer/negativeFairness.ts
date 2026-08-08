// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

import type { TranslationBenchTargetAction } from "./benchmark.js";
import type {
    TranslationBenchGeneratedCandidate,
    TranslationBenchReviewIssue,
    TranslationBenchReviewerDecision,
} from "./generationCandidate.js";
import { parseWithZod } from "./zodJson.js";

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

const assessmentSchema = z
    .object({
        path: z.string().trim().min(1),
        kind: z.enum(TRANSLATION_BENCH_NEGATIVE_KINDS),
        fairEmptyGold: z.boolean(),
        reason: z.string().trim().min(1),
    })
    .strict();

const assessmentsSchema = z.array(assessmentSchema);

export type TranslationBenchNegativeFairnessAssessment = z.infer<
    typeof assessmentSchema
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
    "of the target, non-action status/definition/meta question, or missing-info " +
    "clarification. Never use contrastive adjacent commands, refuse-then-alternate " +
    "forms, capability questions that still solicit an action, how-to-perform-target " +
    "or soft solicits, or any imperative a correct translator would map to another tool.";

function rewriteHint(target: TranslationBenchTargetAction): string {
    const key = `${target.schemaName}.${target.actionName}`;
    return (
        `Rewrite as a pure refusal of ${key}, a non-action status/definition/meta ` +
        `question, or a missing-info clarification. No contrastive, how-to-perform-target, ` +
        `or refuse-then-alternate empty gold.`
    );
}

export function translationBenchNegativeAssessmentsJsonSchema(): Record<
    string,
    unknown
> {
    const schema = z.toJSONSchema(assessmentsSchema) as Record<string, unknown>;
    delete schema.$schema;
    return schema;
}

export function parseTranslationBenchNegativeFairnessAssessments(
    value: unknown,
): TranslationBenchNegativeFairnessAssessment[] {
    return parseWithZod(assessmentsSchema, value, "negativeAssessments");
}

export function checkTranslationBenchNegativeFairnessAssessment(
    assessment: TranslationBenchNegativeFairnessAssessment,
    utterance: string,
    target: TranslationBenchTargetAction,
): TranslationBenchNegativeFairnessResult {
    const suggestedFix = rewriteHint(target);
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

function badNegative(
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
    const fix = rewriteHint(target);

    if (negatives.length === 0) {
        if (assessments.length === 0) return [];
        return [
            badNegative(
                "$.negativeAssessments",
                "negativeAssessments is non-empty but candidate has no negatives",
                "Emit negativeAssessments: [].",
            ),
        ];
    }

    if (assessments.length !== negatives.length) {
        return [
            badNegative(
                "$.negativeAssessments",
                `Expected ${negatives.length} negativeAssessments, got ${assessments.length}`,
                "Emit exactly one assessment per negative genCase path.",
            ),
        ];
    }

    // Join key is assessment.path (exact match to $.genCases[i].utterance).
    // Require a bijective covering set — no index pairing, no wrong paths.
    const expectedByPath = new Map(
        negatives.map((neg) => [neg.path, neg] as const),
    );
    const seenPaths = new Set<string>();
    const pathIssues: TranslationBenchReviewIssue[] = [];

    for (const assessment of assessments) {
        if (!expectedByPath.has(assessment.path)) {
            pathIssues.push(
                badNegative(
                    "$.negativeAssessments",
                    `Unknown assessment path "${assessment.path}"; expected exactly the negative genCase paths`,
                    "Set each assessment.path to the matching negative $.genCases[i].utterance.",
                ),
            );
            continue;
        }
        if (seenPaths.has(assessment.path)) {
            pathIssues.push(
                badNegative(
                    "$.negativeAssessments",
                    `Duplicate assessment path "${assessment.path}"`,
                    "Emit exactly one assessment per negative genCase path.",
                ),
            );
            continue;
        }
        seenPaths.add(assessment.path);
    }

    for (const neg of negatives) {
        if (!seenPaths.has(neg.path)) {
            pathIssues.push(
                badNegative(
                    "$.negativeAssessments",
                    `Missing assessment for negative path "${neg.path}"`,
                    "Emit one assessment whose path equals each negative $.genCases[i].utterance.",
                ),
            );
        }
    }

    if (pathIssues.length > 0) {
        // Collapse to a single gate issue when the path set is wrong — fail closed.
        return [
            badNegative(
                "$.negativeAssessments",
                pathIssues.map((i) => i.message).join("; "),
                "Emit a 1:1 covering set of negativeAssessments keyed by exact negative genCase path.",
            ),
        ];
    }

    const issues: TranslationBenchReviewIssue[] = [];
    for (const assessment of assessments) {
        const neg = expectedByPath.get(assessment.path)!;
        const result = checkTranslationBenchNegativeFairnessAssessment(
            assessment,
            neg.utterance,
            target,
        );
        if (!result.ok) {
            issues.push(
                badNegative(
                    neg.path,
                    result.message ?? fix,
                    result.suggestedFix ?? fix,
                ),
            );
        }
    }
    return issues;
}

function issueKey(issue: TranslationBenchReviewIssue): string {
    return `${issue.code}\0${issue.path}\0${issue.message}`;
}

export function applyTranslationBenchNegativeFairnessIssues(
    decision: TranslationBenchReviewerDecision,
    fairnessIssues: readonly TranslationBenchReviewIssue[],
): TranslationBenchReviewerDecision {
    if (fairnessIssues.length === 0) return decision;

    const seen = new Set(decision.issues.map(issueKey));
    const issues = decision.issues.concat(
        fairnessIssues.filter((issue) => !seen.has(issueKey(issue))),
    );

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
