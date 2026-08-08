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
}

export const TRANSLATION_BENCH_NEGATIVE_FAIRNESS_RULE =
    "Empty-gold negatives must be fair under zero-action scoring: pure refusal " +
    "of the target, non-action status/definition/meta question, or missing-info " +
    "clarification. Never use contrastive adjacent commands, refuse-then-alternate " +
    "forms, capability questions that still solicit an action, how-to-perform-target " +
    "or soft solicits, or any imperative a correct translator would map to another tool.";

const FIX =
    "Rewrite as a fair empty-gold negative (pure_refusal, non_action_question, or missing_info).";

const PATH_MSG =
    "negativeAssessments paths must cover negative genCases 1:1 (exact path, no duplicates).";

function bad(
    path: string,
    message: string,
): TranslationBenchReviewIssue {
    return { code: "BAD_NEGATIVE", path, message, suggestedFix: FIX };
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

export function isFairEmptyGoldAssessment(
    assessment: TranslationBenchNegativeFairnessAssessment,
): boolean {
    return assessment.fairEmptyGold && FAIR_KINDS.has(assessment.kind);
}

export function checkTranslationBenchNegativeFairnessAssessment(
    assessment: TranslationBenchNegativeFairnessAssessment,
    utterance: string,
    _target: TranslationBenchTargetAction,
): TranslationBenchNegativeFairnessResult {
    void _target;
    return {
        ok: isFairEmptyGoldAssessment(assessment),
        kind: assessment.kind,
        path: assessment.path,
        utterance,
    };
}

function negativePaths(
    candidate: TranslationBenchGeneratedCandidate,
): Set<string> {
    const paths = new Set<string>();
    for (const [index, genCase] of candidate.genCases.entries()) {
        if (genCase.role === "negative") {
            paths.add(`$.genCases[${index}].utterance`);
        }
    }
    return paths;
}

function pathsCover(
    expected: ReadonlySet<string>,
    assessments: readonly TranslationBenchNegativeFairnessAssessment[],
): boolean {
    if (assessments.length !== expected.size) return false;
    const seen = new Set<string>();
    for (const a of assessments) {
        if (!expected.has(a.path) || seen.has(a.path)) return false;
        seen.add(a.path);
    }
    return seen.size === expected.size;
}

export function checkTranslationBenchCandidateNegativeFairness(
    candidate: TranslationBenchGeneratedCandidate,
    _target: TranslationBenchTargetAction,
    assessments: readonly TranslationBenchNegativeFairnessAssessment[],
): TranslationBenchReviewIssue[] {
    void _target;
    const expected = negativePaths(candidate);

    if (expected.size === 0) {
        return assessments.length === 0
            ? []
            : [bad("$.negativeAssessments", PATH_MSG)];
    }

    if (!pathsCover(expected, assessments)) {
        return [bad("$.negativeAssessments", PATH_MSG)];
    }

    return assessments
        .filter((a) => !isFairEmptyGoldAssessment(a))
        .map((a) => bad(a.path, a.reason));
}

export function applyTranslationBenchNegativeFairnessIssues(
    decision: TranslationBenchReviewerDecision,
    fairnessIssues: readonly TranslationBenchReviewIssue[],
): TranslationBenchReviewerDecision {
    if (fairnessIssues.length === 0) return decision;

    const seen = new Set(
        decision.issues.map((i) => `${i.code}\0${i.path}\0${i.message}`),
    );
    const issues = decision.issues.concat(
        fairnessIssues.filter(
            (i) => !seen.has(`${i.code}\0${i.path}\0${i.message}`),
        ),
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
                ? "Rejected: empty-gold negative fairness failed"
                : decision.summary,
    };
}
