// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

import type { TranslationBenchTargetAction } from "./benchmark.js";
import type {
    TranslationBenchGeneratedCandidate,
    TranslationBenchGeneratedCase,
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

/** Only pure_refusal is zero-action-safe under the full tool catalog. */
export const TRANSLATION_BENCH_FAIR_EMPTY_GOLD_KINDS = [
    "pure_refusal",
] as const;

const FAIR_KINDS = new Set<TranslationBenchNegativeKind>(
    TRANSLATION_BENCH_FAIR_EMPTY_GOLD_KINDS,
);

export const TRANSLATION_BENCH_NEGATIVE_FAIRNESS_RULE =
    "Empty-gold negatives must be zero-action-safe under the FULL loaded tool " +
    "catalog (not merely “not the target”): a careful translator must emit no " +
    "actions at all — including chat.generateResponse, system.help.*, history, " +
    "lookup, or any other tool. ALLOWED fair kind: pure_refusal only — explicit " +
    "don't/never/stop/leave-alone/cancel of the target with no alternate task, " +
    "no question, and no request for explanation. FORBIDDEN as empty gold: " +
    "definition/meta/status/how-to questions (even non_action_question labels); " +
    "missing_info that still invites lookup/list/clarify-via-tool; soft solicits; " +
    "capability questions; contrastive adjacent commands; refuse-then-alternate; " +
    "partial constraints that still request an action; any imperative a correct " +
    "translator would map to any loaded tool.";

const FIX =
    "Rewrite as a hard-abstain empty-gold negative (pure_refusal / leave-alone " +
    "only; no questions, no alternate task).";

const PATH_MSG =
    "negativeAssessments paths must cover negative genCases 1:1 (exact path, no duplicates).";

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

function bad(path: string, message: string): TranslationBenchReviewIssue {
    return { code: "BAD_NEGATIVE", path, message, suggestedFix: FIX };
}

function negativeByPath(
    candidate: TranslationBenchGeneratedCandidate,
): Map<string, TranslationBenchGeneratedCase> {
    const byPath = new Map<string, TranslationBenchGeneratedCase>();
    for (const [index, genCase] of candidate.genCases.entries()) {
        if (genCase.role === "negative") {
            byPath.set(`$.genCases[${index}].utterance`, genCase);
        }
    }
    return byPath;
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

export function checkTranslationBenchCandidateNegativeFairness(
    candidate: TranslationBenchGeneratedCandidate,
    _target: TranslationBenchTargetAction,
    assessments: readonly TranslationBenchNegativeFairnessAssessment[],
): TranslationBenchReviewIssue[] {
    void _target;
    const negatives = negativeByPath(candidate);

    if (negatives.size === 0) {
        return assessments.length === 0
            ? []
            : [bad("$.negativeAssessments", PATH_MSG)];
    }
    if (assessments.length !== negatives.size) {
        return [bad("$.negativeAssessments", PATH_MSG)];
    }

    const seen = new Set<string>();
    const issues: TranslationBenchReviewIssue[] = [];
    for (const a of assessments) {
        const genCase = negatives.get(a.path);
        if (!genCase || seen.has(a.path)) {
            return [bad("$.negativeAssessments", PATH_MSG)];
        }
        seen.add(a.path);

        if (!isFairEmptyGoldAssessment(a)) {
            issues.push(bad(a.path, a.reason));
            continue;
        }

        const dimKind = genCase.dimensions.negativeKind;
        if (
            typeof dimKind === "string" &&
            !FAIR_KINDS.has(dimKind as TranslationBenchNegativeKind)
        ) {
            issues.push(
                bad(
                    a.path,
                    `dimensions.negativeKind=${dimKind} is not zero-action-safe empty gold; use pure_refusal only`,
                ),
            );
        }
    }
    return issues;
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
