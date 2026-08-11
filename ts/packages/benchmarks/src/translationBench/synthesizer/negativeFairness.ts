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
    "lookup, or any other tool. ALLOWED fair kind: pure_refusal only — the " +
    "utterance MUST OPEN with don't/do not/never/leave-alone/hands-off/do-nothing/" +
    "refrain-from/avoid-doing of the target, with no alternate task, no question, " +
    "and no request for explanation. Bare stop/cancel/sibling imperatives and " +
    "“do X but don't Y” partial constraints are NOT fair empty gold. FORBIDDEN: " +
    "definition/meta/status/how-to questions; missing_info that invites tools; " +
    "soft solicits; capability questions; contrastive adjacent/sibling commands; " +
    "refuse-then-alternate; any imperative a correct translator would map to any " +
    "loaded tool.";

const FIX =
    "Rewrite as a hard-abstain empty-gold negative that OPENS with don't/do not/" +
    "never/leave-alone (no questions, no alternate or sibling task).";

const PATH_MSG =
    "negativeAssessments paths must cover negative genCases 1:1 (exact path, no duplicates).";

/** ; | em-dash | en-dash | spaced hyphen — never bare `.` (schema.action / domains). */
const CLAUSE_SEP = String.raw`(?:[;]|\u2014|\u2013|\s-\s)`;

/**
 * Clause separators for multi-part empties. Deliberately excludes `.` so
 * schema.action tags, domains, and abbreviations do not false-split.
 */
const CLAUSE_SPLIT_RE = new RegExp(String.raw`\s*${CLAUSE_SEP}\s*`);

/**
 * Trailing clauses that still mean abstain (not a new tool request).
 * Stripped before secondary-clause checks.
 */
const ABSTAIN_TRAIL_RE = new RegExp(
    String.raw`${CLAUSE_SEP}\s*(?:I\b[\s\S]*|let\s+it\b[\s\S]*|leave\b[\s\S]*?\b(?:alone|unchanged|untouched)\b[\s\S]*|keep\b[\s\S]*|stay\b[\s\S]*|so\b[\s\S]*|because\b[\s\S]*|since\b[\s\S]*)$`,
    "i",
);

const OPENS_REFUSE_RE = /^(?:please\s+)?(?:do\s+not|don'?t|never)\b/i;

const OPENS_LEAVE_ALONE_RE = /^(?:please\s+)?leave\b[\s\S]{0,48}\balone\b/i;

const OPENS_OTHER_ABSTAIN_RE =
    /^(?:please\s+)?(?:hands\s+off|do\s+nothing|refrain\s+from)\b/i;

const OPENS_AVOID_DOING_RE =
    /^(?:please\s+)?avoid\s+(?:doing|opening|closing|taking|capturing|running|starting|sending|changing|switching|deleting|creating|enabling|disabling)\b/i;

/** Interrogative openers — exclude "do not" / "don't" (handled as refuse). */
const INTERROGATIVE_OPENER_RE =
    /^(?:what|why|how|when|where|who|which|is|are|can|could|would|should|does|did|will|have|has|was|were|what's|how's|who's|do(?!\s+not)\b)/i;

const SOFT_SOLICIT_RE =
    /\b(?:can you|could you|would you(?: mind)?|are you able|do you (?:know|support|handle)|is it possible|is there a way)\b/i;

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
    /** Present when the deterministic utterance shape gate fails. */
    utteranceReason?: string;
}

export interface TranslationBenchEmptyGoldUtteranceAssessment {
    fair: boolean;
    reason: string;
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

/**
 * Deterministic empty-gold utterance shape gate.
 *
 * LLM negativeAssessments alone are insufficient: the 1k-20260807-disambig set
 * labeled ~100% of empties as review-approved while ~99% were contrastive
 * sibling commands, how-to/status questions, or refuse-then-alternate forms
 * (eval FPR ~97%). Labels may only approve pure_refusal when the utterance
 * itself opens as a hard abstain and carries no toolable follow-on.
 *
 * Conservative by design — prefer false reject (regen) over false approve.
 */
export function assessEmptyGoldUtterance(
    utterance: string,
): TranslationBenchEmptyGoldUtteranceAssessment {
    const raw = String(utterance ?? "").trim();
    if (!raw) {
        return { fair: false, reason: "empty utterance" };
    }
    const t = raw.replace(/\s+/g, " ");

    if (/[?]/.test(t)) {
        return {
            fair: false,
            reason: "question mark (invites chat/help/lookup)",
        };
    }
    // Check refuse openers before interrogative so "Do not …" is not
    // misclassified as the bare auxiliary "Do …?".
    const opensRefuse =
        OPENS_REFUSE_RE.test(t) ||
        OPENS_LEAVE_ALONE_RE.test(t) ||
        OPENS_OTHER_ABSTAIN_RE.test(t) ||
        OPENS_AVOID_DOING_RE.test(t);
    if (!opensRefuse) {
        if (INTERROGATIVE_OPENER_RE.test(t)) {
            return { fair: false, reason: "interrogative opener" };
        }
        return {
            fair: false,
            reason: "does not open as pure refusal (need don't/do not/never/leave-alone)",
        };
    }
    if (SOFT_SOLICIT_RE.test(t)) {
        return { fair: false, reason: "soft solicit or capability phrasing" };
    }
    if (/\b(?:instead|rather\s+than)\b/i.test(t)) {
        return { fair: false, reason: "contrastive instead/rather" };
    }
    if (/\bjust\b/i.test(t)) {
        return {
            fair: false,
            reason: "just-alternate (refuse-then-alternate or partial task)",
        };
    }
    if (/\b(?:tell|explain|describe|summarize)\b/i.test(t)) {
        return {
            fair: false,
            reason: "requests explanation (chat/help under full catalog)",
        };
    }

    // Strip a single allowed trailing abstain/reason clause, then reject any
    // leftover secondary clause that is not itself abstain/reason.
    const stripped = t.replace(ABSTAIN_TRAIL_RE, "").trim();
    const parts = stripped
        .split(CLAUSE_SPLIT_RE)
        .map((s) => s.trim())
        .filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
        const p = parts[i]!;
        if (
            /^(?:I\b|let\b|leave\b|keep\b|stay\b|so\b|because\b|since\b)/i.test(
                p,
            )
        ) {
            continue;
        }
        return {
            fair: false,
            reason: `secondary clause not abstain/reason: "${p.slice(0, 80)}"`,
        };
    }

    return { fair: true, reason: "pure refusal / leave-alone" };
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
    if (!isFairEmptyGoldAssessment(assessment)) {
        return {
            ok: false,
            kind: assessment.kind,
            path: assessment.path,
            utterance,
        };
    }
    const shape = assessEmptyGoldUtterance(utterance);
    return {
        ok: shape.fair,
        kind: assessment.kind,
        path: assessment.path,
        utterance,
        ...(shape.fair ? {} : { utteranceReason: shape.reason }),
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
        if (dimKind !== a.kind) {
            issues.push(
                bad(
                    a.path,
                    `dimensions.negativeKind=${String(dimKind)} must equal the accepted empty-gold kind '${a.kind}' (pure_refusal only)`,
                ),
            );
            continue;
        }

        const shape = assessEmptyGoldUtterance(genCase.utterance);
        if (!shape.fair) {
            issues.push(
                bad(
                    a.path,
                    `empty-gold utterance failed pure-refusal shape gate: ${shape.reason}`,
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
