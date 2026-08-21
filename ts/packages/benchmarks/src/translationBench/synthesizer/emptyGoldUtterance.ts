// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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

export interface TranslationBenchEmptyGoldUtteranceAssessment {
    fair: boolean;
    reason: string;
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
