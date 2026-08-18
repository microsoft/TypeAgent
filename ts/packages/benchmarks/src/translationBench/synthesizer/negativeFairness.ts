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
    "lookup, or any other tool. ALLOWED fair kind: pure_refusal only — a hard " +
    "abstain of the target (don't / do not / never / leave-alone / hands-off / " +
    "do-nothing / refrain-from / avoid-doing), with no alternate task, no " +
    "question, and no request for explanation. Bare stop/cancel/sibling " +
    "imperatives and “do X but don't Y” partial constraints are NOT fair empty " +
    "gold. FORBIDDEN: definition/meta/status/how-to questions; missing_info " +
    "that invites tools; soft solicits; capability questions; contrastive " +
    "adjacent/sibling commands; refuse-then-alternate; any imperative a " +
    "correct translator would map to any loaded tool.";

const FIX =
    "Rewrite as a hard-abstain empty-gold negative that OPENS with don't/do not/" +
    "never/leave-alone (no questions, no alternate or sibling task).";

const PATH_MSG =
    "negativeAssessments paths must cover negative genCases 1:1 (exact path, no duplicates).";

const assessmentSchema = z
    .object({
        path: z.string().trim().min(1),
        kind: z.enum(TRANSLATION_BENCH_NEGATIVE_KINDS),
        fairEmptyGold: z.boolean(),
        reason: z.string().trim().min(1),
        // Atomic LLM flags — judged independently, then checked for consistency
        // with fairEmptyGold. Replaces the former utterance regex shape gate.
        opensAsHardAbstain: z.boolean(),
        hasAlternateOrSiblingTask: z.boolean(),
        hasQuestionOrExplanationRequest: z.boolean(),
        mapsToAnyLoadedTool: z.boolean(),
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
    /** Present when the LLM flags are not a consistent fair empty-gold. */
    reason?: string;
}

function bad(path: string, message: string): TranslationBenchReviewIssue {
    return { code: "BAD_NEGATIVE", path, message, suggestedFix: FIX };
}

export function translationBenchNegativeAssessmentPath(index: number): string {
    return `$.genCases[${index}].utterance`;
}

export function translationBenchNegativeAssessmentPaths(
    candidate: TranslationBenchGeneratedCandidate,
): string[] {
    const paths: string[] = [];
    for (const [index, genCase] of candidate.genCases.entries()) {
        if (genCase.role === "negative") {
            paths.push(translationBenchNegativeAssessmentPath(index));
        }
    }
    return paths;
}

/** Mechanical path-syntax aliases → `$.genCases[N].utterance`. */
export function canonicalizeTranslationBenchNegativeAssessmentPath(
    path: string,
): string {
    const trimmed = path.trim();
    const match =
        /^(?:\$\.)?genCases\[(\d+)\](?:\.utterance)?$/.exec(trimmed) ??
        /^(?:\$\.)?genCases\.(\d+)(?:\.utterance)?$/.exec(trimmed) ??
        /^\/genCases\/(\d+)(?:\/utterance)?$/.exec(trimmed);
    if (match === null) {
        return trimmed;
    }
    return translationBenchNegativeAssessmentPath(Number(match[1]));
}

function negativeByPath(
    candidate: TranslationBenchGeneratedCandidate,
): Map<string, TranslationBenchGeneratedCase> {
    const byPath = new Map<string, TranslationBenchGeneratedCase>();
    for (const [index, genCase] of candidate.genCases.entries()) {
        if (genCase.role === "negative") {
            byPath.set(translationBenchNegativeAssessmentPath(index), genCase);
        }
    }
    return byPath;
}

/** True when the four atomic flags describe a hard abstain with no toolable follow-on. */
export function decomposedFlagsAreFair(
    assessment: TranslationBenchNegativeFairnessAssessment,
): boolean {
    return (
        assessment.opensAsHardAbstain &&
        !assessment.hasAlternateOrSiblingTask &&
        !assessment.hasQuestionOrExplanationRequest &&
        !assessment.mapsToAnyLoadedTool
    );
}

function inconsistentFairFlagsMessage(
    assessment: TranslationBenchNegativeFairnessAssessment,
): string {
    const parts = [
        `opensAsHardAbstain=${String(assessment.opensAsHardAbstain)}`,
        `hasAlternateOrSiblingTask=${String(assessment.hasAlternateOrSiblingTask)}`,
        `hasQuestionOrExplanationRequest=${String(assessment.hasQuestionOrExplanationRequest)}`,
        `mapsToAnyLoadedTool=${String(assessment.mapsToAnyLoadedTool)}`,
    ];
    return `empty-gold flags inconsistent with fairEmptyGold=true (${parts.join(", ")})`;
}

export function translationBenchNegativeAssessmentsJsonSchema(
    requiredPaths?: readonly string[],
): Record<string, unknown> {
    const pathSchema =
        requiredPaths !== undefined && requiredPaths.length > 0
            ? { type: "string", enum: [...requiredPaths] }
            : { type: "string", minLength: 1 };
    return {
        type: "array",
        ...(requiredPaths !== undefined
            ? {
                  minItems: requiredPaths.length,
                  maxItems: requiredPaths.length,
              }
            : {}),
        items: {
            type: "object",
            additionalProperties: false,
            required: [
                "path",
                "kind",
                "fairEmptyGold",
                "reason",
                "opensAsHardAbstain",
                "hasAlternateOrSiblingTask",
                "hasQuestionOrExplanationRequest",
                "mapsToAnyLoadedTool",
            ],
            properties: {
                path: pathSchema,
                kind: {
                    type: "string",
                    enum: [...TRANSLATION_BENCH_NEGATIVE_KINDS],
                },
                fairEmptyGold: { type: "boolean" },
                reason: { type: "string", minLength: 1 },
                opensAsHardAbstain: { type: "boolean" },
                hasAlternateOrSiblingTask: { type: "boolean" },
                hasQuestionOrExplanationRequest: { type: "boolean" },
                mapsToAnyLoadedTool: { type: "boolean" },
            },
        },
    };
}

export function parseTranslationBenchNegativeFairnessAssessments(
    value: unknown,
): TranslationBenchNegativeFairnessAssessment[] {
    return parseWithZod(assessmentsSchema, value, "negativeAssessments");
}

export function isFairEmptyGoldAssessment(
    assessment: TranslationBenchNegativeFairnessAssessment,
): boolean {
    return (
        assessment.fairEmptyGold &&
        FAIR_KINDS.has(assessment.kind) &&
        decomposedFlagsAreFair(assessment)
    );
}

export function checkTranslationBenchNegativeFairnessAssessment(
    assessment: TranslationBenchNegativeFairnessAssessment,
    utterance: string,
    _target: TranslationBenchTargetAction,
): TranslationBenchNegativeFairnessResult {
    void _target;
    if (!isFairEmptyGoldAssessment(assessment)) {
        const reason =
            assessment.fairEmptyGold && FAIR_KINDS.has(assessment.kind)
                ? inconsistentFairFlagsMessage(assessment)
                : assessment.reason;
        return {
            ok: false,
            kind: assessment.kind,
            path: assessment.path,
            utterance,
            reason,
        };
    }
    return {
        ok: true,
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
        const path = canonicalizeTranslationBenchNegativeAssessmentPath(a.path);
        const genCase = negatives.get(path);
        if (!genCase || seen.has(path)) {
            return [bad("$.negativeAssessments", PATH_MSG)];
        }
        seen.add(path);

        if (!isFairEmptyGoldAssessment(a)) {
            const message =
                a.fairEmptyGold && FAIR_KINDS.has(a.kind)
                    ? inconsistentFairFlagsMessage(a)
                    : a.reason;
            issues.push(bad(path, message));
            continue;
        }

        const dimKind = genCase.dimensions.negativeKind;
        if (dimKind !== a.kind) {
            issues.push(
                bad(
                    path,
                    `dimensions.negativeKind=${String(dimKind)} must equal the accepted empty-gold kind '${a.kind}' (pure_refusal only)`,
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
