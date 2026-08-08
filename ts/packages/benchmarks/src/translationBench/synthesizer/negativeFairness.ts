// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * LLM-judged fairness gates for translation-bench *negative* gen cases.
 *
 * Problem this solves
 * -------------------
 * Negatives always carry expectedActions: [] and the headless scorer treats
 * that as "model must emit zero actions". The synthesizer historically also
 * allowed *contrastive adjacent intents* ("close only this tab" as a negative
 * for closeAllWebPages, "search Bing for MSFT" as a negative for
 * changeSearchProvider). Those utterances are real toolable requests, so a
 * correct translator fires an action and is scored as a false positive. That
 * made overall pass rate look ~38% while tool/param scores stayed healthy.
 *
 * Contract enforced here
 * ----------------------
 * Empty-gold negatives must be utterances where emitting *no* TypeAgent action
 * is the fair label — pure refusal of the target, non-action status/howto
 * questions, or missing-info clarification. Imperative requests for a different
 * concrete agent action (including refuse-then-alternate multi-clause forms)
 * are rejected as BAD_NEGATIVE.
 *
 * Scope: the semantic quality-verifier LLM classifies each negative. Code only
 * validates the structured assessment and hard-fails unfair kinds — no verb
 * lexicons or ACTION_VP regexes.
 *
 * Used by:
 *   - synthesizer / quality-verifier prompts (policy text)
 *   - semantic_checker (required negativeAssessments + hard reject)
 */

import type { TranslationBenchTargetAction } from "./benchmark.js";
import type {
    TranslationBenchGeneratedCandidate,
    TranslationBenchReviewIssue,
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

const UNFAIR_KINDS = new Set<TranslationBenchNegativeKind>([
    "unfair_contrastive",
    "unfair_imperative",
    "unfair_sibling_command",
    "unknown",
]);

export interface TranslationBenchNegativeFairnessAssessment {
    /** JSON-path of the negative utterance, e.g. `$.genCases[1].utterance`. */
    path: string;
    kind: TranslationBenchNegativeKind;
    /** True only when zero actions is the fair gold label. */
    fairEmptyGold: boolean;
    reason: string;
}

export interface TranslationBenchNegativeFairnessResult {
    ok: boolean;
    kind: TranslationBenchNegativeKind;
    path: string;
    utterance: string;
    message?: string;
    suggestedFix?: string;
}

/** Operator-facing policy text shared by synthesizer + quality verifier. */
export const TRANSLATION_BENCH_NEGATIVE_FAIRNESS_RULE =
    "Empty-gold negatives must be fair under zero-action scoring: pure refusal " +
    "of the target, non-action status/howto question, or missing-info " +
    "clarification. Never use contrastive adjacent commands, refuse-then-alternate " +
    "forms, capability questions that still solicit an action, or any imperative " +
    "a correct translator would map to another tool.";

export function translationBenchNegativeFairnessRewriteHint(
    target: TranslationBenchTargetAction,
): string {
    const targetKey = `${target.schemaName}.${target.actionName}`;
    return (
        `Rewrite as a pure refusal of ${targetKey}, a non-action status/howto ` +
        `question, or a missing-info clarification. Never use contrastive ` +
        `adjacent commands or refuse-then-alternate forms with empty gold.`
    );
}

export function isFairTranslationBenchNegativeKind(
    kind: TranslationBenchNegativeKind,
): boolean {
    return FAIR_KINDS.has(kind);
}

/**
 * JSON-schema fragment for semantic_checker `negativeAssessments`.
 * One object per negative genCase (empty array when the candidate has none).
 */
export function translationBenchNegativeAssessmentsJsonSchema(): Record<
    string,
    unknown
> {
    return {
        type: "array",
        description:
            "One assessment per negative genCase. Decide whether empty expectedActions is a fair gold label — do not use verb lists; judge intent.",
        items: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    minLength: 1,
                    description:
                        "JSON path of the negative utterance (e.g. $.genCases[1].utterance)",
                },
                kind: {
                    type: "string",
                    enum: [...TRANSLATION_BENCH_NEGATIVE_KINDS],
                },
                fairEmptyGold: {
                    type: "boolean",
                    description:
                        "true only when emitting zero TypeAgent actions is the correct label",
                },
                reason: { type: "string", minLength: 1 },
            },
            required: ["path", "kind", "fairEmptyGold", "reason"],
            additionalProperties: false,
        },
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNegativeKind(value: unknown): value is TranslationBenchNegativeKind {
    return (
        typeof value === "string" &&
        (TRANSLATION_BENCH_NEGATIVE_KINDS as readonly string[]).includes(value)
    );
}

/**
 * Parse LLM negativeAssessments. Fail closed on shape errors.
 */
export function parseTranslationBenchNegativeFairnessAssessments(
    value: unknown,
): TranslationBenchNegativeFairnessAssessment[] {
    if (!Array.isArray(value)) {
        throw new Error("negativeAssessments must be an array");
    }
    return value.map((item, index) => {
        if (!isObject(item)) {
            throw new Error(`negativeAssessments[${index}] must be an object`);
        }
        const path = item.path;
        const kind = item.kind;
        const fairEmptyGold = item.fairEmptyGold;
        const reason = item.reason;
        if (typeof path !== "string" || path.trim().length === 0) {
            throw new Error(
                `negativeAssessments[${index}].path must be a non-empty string`,
            );
        }
        if (!isNegativeKind(kind)) {
            throw new Error(
                `negativeAssessments[${index}].kind must be one of ${TRANSLATION_BENCH_NEGATIVE_KINDS.join(", ")}`,
            );
        }
        if (typeof fairEmptyGold !== "boolean") {
            throw new Error(
                `negativeAssessments[${index}].fairEmptyGold must be a boolean`,
            );
        }
        if (typeof reason !== "string" || reason.trim().length === 0) {
            throw new Error(
                `negativeAssessments[${index}].reason must be a non-empty string`,
            );
        }
        return {
            path: path.trim(),
            kind,
            fairEmptyGold,
            reason: reason.trim(),
        };
    });
}

/**
 * Deterministic consistency check on one LLM assessment (no utterance NLP).
 * fairEmptyGold must match kind fairness; unfair kinds cannot claim fair gold.
 */
export function checkTranslationBenchNegativeFairnessAssessment(
    assessment: TranslationBenchNegativeFairnessAssessment,
    utterance: string,
    target: TranslationBenchTargetAction,
): TranslationBenchNegativeFairnessResult {
    const rewriteHint = translationBenchNegativeFairnessRewriteHint(target);
    const targetKey = `${target.schemaName}.${target.actionName}`;
    const fairKind = isFairTranslationBenchNegativeKind(assessment.kind);

    if (assessment.fairEmptyGold && !fairKind) {
        return {
            ok: false,
            kind: assessment.kind,
            path: assessment.path,
            utterance,
            message:
                `LLM marked fairEmptyGold=true with unfair kind ` +
                `${assessment.kind} for ${targetKey}: ${assessment.reason}`,
            suggestedFix: rewriteHint,
        };
    }
    if (!assessment.fairEmptyGold || !fairKind) {
        return {
            ok: false,
            kind: UNFAIR_KINDS.has(assessment.kind)
                ? assessment.kind
                : "unknown",
            path: assessment.path,
            utterance,
            message:
                assessment.reason.trim() ||
                `Negative is not a fair empty-gold case for ${targetKey}.`,
            suggestedFix: rewriteHint,
        };
    }
    return {
        ok: true,
        kind: assessment.kind,
        path: assessment.path,
        utterance,
    };
}

function negativePaths(
    candidate: TranslationBenchGeneratedCandidate,
): { path: string; utterance: string; index: number }[] {
    const out: { path: string; utterance: string; index: number }[] = [];
    for (const [index, genCase] of candidate.genCases.entries()) {
        if (genCase.role !== "negative") continue;
        out.push({
            path: `$.genCases[${index}].utterance`,
            utterance: genCase.utterance,
            index,
        });
    }
    return out;
}

/**
 * Map LLM assessments → BAD_NEGATIVE issues. Requires exactly one assessment
 * per negative genCase (matched by path or by stable negative order).
 */
export function checkTranslationBenchCandidateNegativeFairness(
    candidate: TranslationBenchGeneratedCandidate,
    target: TranslationBenchTargetAction,
    assessments: readonly TranslationBenchNegativeFairnessAssessment[],
): TranslationBenchReviewIssue[] {
    const negatives = negativePaths(candidate);
    const rewriteHint = translationBenchNegativeFairnessRewriteHint(target);
    const issues: TranslationBenchReviewIssue[] = [];

    if (negatives.length === 0) {
        if (assessments.length > 0) {
            issues.push({
                code: "BAD_NEGATIVE",
                path: "$.negativeAssessments",
                message:
                    "negativeAssessments is non-empty but the candidate has no negative genCases",
                suggestedFix:
                    "Emit negativeAssessments: [] when there are no negatives.",
            });
        }
        return issues;
    }

    if (assessments.length !== negatives.length) {
        issues.push({
            code: "BAD_NEGATIVE",
            path: "$.negativeAssessments",
            message:
                `Expected ${negatives.length} negativeAssessments (one per negative genCase), ` +
                `got ${assessments.length}.`,
            suggestedFix:
                "Emit exactly one negativeAssessments entry per negative genCase path.",
        });
        return issues;
    }

    const byPath = new Map(
        assessments.map((a) => [a.path.replace(/^\$\./, "").replace(/^\$./, ""), a]),
    );
    // Also index raw paths and genCases[i] forms.
    for (const a of assessments) {
        byPath.set(a.path, a);
        byPath.set(a.path.replace(/^\$/, ""), a);
        byPath.set(a.path.replace(/^\$\./, ""), a);
    }

    const used = new Set<TranslationBenchNegativeFairnessAssessment>();
    for (const [i, neg] of negatives.entries()) {
        let assessment =
            byPath.get(neg.path) ??
            byPath.get(neg.path.replace(/^\$\./, "")) ??
            byPath.get(`genCases[${neg.index}].utterance`);
        // Fall back to order when the model omits/ mistypes path but count matches.
        if (assessment === undefined) {
            assessment = assessments[i];
        }
        if (assessment === undefined || used.has(assessment)) {
            issues.push({
                code: "BAD_NEGATIVE",
                path: neg.path,
                message: `Missing negativeAssessments entry for ${neg.path}`,
                suggestedFix: rewriteHint,
            });
            continue;
        }
        used.add(assessment);
        const result = checkTranslationBenchNegativeFairnessAssessment(
            assessment,
            neg.utterance,
            target,
        );
        if (!result.ok) {
            issues.push({
                code: "BAD_NEGATIVE",
                path: neg.path,
                message: result.message!,
                suggestedFix: result.suggestedFix ?? rewriteHint,
            });
        }
    }
    return issues;
}

/**
 * Merge LLM fairness issues into a reviewer decision (force reject).
 */
export function applyTranslationBenchNegativeFairnessIssues<
    T extends {
        decision: "approve" | "reject";
        issues: TranslationBenchReviewIssue[];
        summary: string;
        scores: { negativeQuality: number };
    },
>(decision: T, fairnessIssues: readonly TranslationBenchReviewIssue[]): T {
    if (fairnessIssues.length === 0) return decision;
    const existing = decision.issues;
    const merged = [
        ...existing,
        ...fairnessIssues.filter(
            (issue) =>
                !existing.some(
                    (e) =>
                        e.code === issue.code &&
                        e.path === issue.path &&
                        e.message === issue.message,
                ),
        ),
    ];
    return {
        ...decision,
        decision: "reject",
        issues: merged,
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
