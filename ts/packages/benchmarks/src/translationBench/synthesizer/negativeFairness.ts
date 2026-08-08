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

/**
 * Empty gold means the headless scorer requires ZERO actions across the full
 * active catalog (chat/help/history/lookup included). Only hard-abstain forms
 * clear that bar. Definition/status/meta questions are label-kinds for audit
 * but must never be fairEmptyGold under zero-action scoring.
 */
const FAIR_KINDS = new Set<TranslationBenchNegativeKind>(["pure_refusal"]);

export const TRANSLATION_BENCH_FAIR_EMPTY_GOLD_KINDS = [
    "pure_refusal",
] as const;

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

function dimensionNegativeKind(
    candidate: TranslationBenchGeneratedCandidate,
    path: string,
): string | undefined {
    const match = /^\$\.genCases\[(\d+)\]\.utterance$/.exec(path);
    if (!match) return undefined;
    const index = Number(match[1]);
    const genCase = candidate.genCases[index];
    if (!genCase || genCase.role !== "negative") return undefined;
    const dims = genCase.dimensions;
    if (!dims || typeof dims !== "object") return undefined;
    const kind = (dims as Record<string, unknown>).negativeKind;
    return typeof kind === "string" ? kind : undefined;
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

    const issues: TranslationBenchReviewIssue[] = [];
    for (const a of assessments) {
        if (!isFairEmptyGoldAssessment(a)) {
            issues.push(bad(a.path, a.reason));
            continue;
        }
        const dimKind = dimensionNegativeKind(candidate, a.path);
        if (
            dimKind !== undefined &&
            dimKind !== "pure_refusal" &&
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
