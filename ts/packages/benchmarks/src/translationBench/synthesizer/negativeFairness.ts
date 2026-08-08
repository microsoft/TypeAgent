// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Deterministic fairness gates for translation-bench *negative* gen cases.
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
 * Scope: English lexical heuristics for format_checker fail-closed gating.
 * Semantic checker still scores negativeQuality independently.
 *
 * Used by:
 *   - synthesizer / quality-verifier prompts (policy text)
 *   - format_checker (hard reject before semantic LLM)
 */

import type {
    TranslationBenchBenchmarkSchema,
    TranslationBenchTargetAction,
} from "./benchmark.js";
import type {
    TranslationBenchGeneratedCandidate,
    TranslationBenchReviewIssue,
} from "./generationCandidate.js";
import {
    findTranslationBenchConfusableSiblings,
    type TranslationBenchConfusableSibling,
} from "./utteranceDisambiguation.js";

export type TranslationBenchNegativeKind =
    | "pure_refusal"
    | "non_action_question"
    | "missing_info"
    | "unfair_contrastive"
    | "unfair_imperative"
    | "unfair_sibling_command"
    | "unknown";

export interface TranslationBenchNegativeFairnessResult {
    ok: boolean;
    kind: TranslationBenchNegativeKind;
    path: string;
    utterance: string;
    message?: string;
    suggestedFix?: string;
}

function keyOf(ref: { schemaName: string; actionName: string }): string {
    return `${ref.schemaName}.${ref.actionName}`;
}

function normalizeUtterance(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Explicit refuse / stop / avoid / leave-alone cues. */
const REFUSAL_CUE =
    /\b(don(?:['’])?t|do\s+not|never|please\s+don(?:['’])?t|stop\s+(?:doing|reading|playing|recording|sharing)?|avoid|refrain\s+from|without\s+(?:doing|changing|opening|closing|deleting|installing|reloading|bookmarking)|keep\s+.{0,40}don(?:['’])?t|no\s+longer|leave\s+.{0,60}\balone\b|do\s+nothing|i(?:['’])?d\s+rather\s+not|no\s+\w+\s+please)\b/i;

/**
 * Agent-command verb phrase. Matched anywhere in a clause (not only ^) so
 * refuse-then-alternate forms still get caught.
 */
const ACTION_VP =
    /\b(?:open(?:ing)?|clos(?:e|ing)|click(?:ing)?|scroll(?:ing)?|go(?:ing)?\s+to|navigat(?:e|ing)|search(?:ing)?|brows(?:e|ing)|visit(?:ing)?|start(?:ing)?|launch(?:ing)?|run(?:ning)?|delet(?:e|ing)|remov(?:e|ing)|creat(?:e|ing)|mak(?:e|ing)|install(?:ing)?|switch(?:ing)?|chang(?:e|ing)|set(?:ting)?|enabl(?:e|ing)|disabl(?:e|ing)|mut(?:e|ing)|unmut(?:e|ing)|play(?:ing)?|paus(?:e|ing)|send(?:ing)?|read(?:ing)?|zoom(?:ing)?|record(?:ing)?|list(?:ing)?|show(?:ing)?|hid(?:e|ing)|mov(?:e|ing)|copy(?:ing)?|past(?:e|ing)|shar(?:e|ing)|invit(?:e|ing)|schedul(?:e|ing)|book(?:ing)?|cancel(?:l?ing)?|add(?:ing)?|updat(?:e|ing)|writ(?:e|ing)|sav(?:e|ing)|load(?:ing)?|download(?:ing)?|upload(?:ing)?|typ(?:e|ing)|press(?:ing)?|toggl(?:e|ing)|adjust(?:ing)?|increas(?:e|ing)|decreas(?:e|ing)|follow(?:ing)?|reload(?:ing)?|refresh(?:ing)?|captur(?:e|ing)|take\s+a\s+screenshot|screenshot(?:ting)?|bookmark(?:ing)?|starr?ing|unstarr?ing|\bstar\b|\bunstar\b|fork(?:ing)?|clon(?:e|ing)|commit(?:ting)?|push(?:ing)?|pull(?:ing)?|merg(?:e|ing)|rebas(?:e|ing)|build(?:ing)?|deploy(?:ing)?|debugg(?:ing)?|attach(?:ing)?|detach(?:ing)?|renam(?:e|ing)|duplicat(?:e|ing)|pinn?ing|unpinn?ing|\bpin\b|\bunpin\b|archiv(?:e|ing)|unarchiv(?:e|ing)|join(?:ing)?|kick(?:ing)?|bann?ing|\bban\b|find(?:ing)?|look(?:ing)?\s+up|look(?:ing)?\s+for|shut(?:ting)?|turn(?:ing)?\s+(?:on|off)|get(?:ting)?|check(?:ing)?|fetch(?:ing)?|query(?:ing)?|select(?:ing)?|pick(?:ing)?|choos(?:e|ing))\b/i;

/** Leading polite / conversational preface before a command. */
const LEADING_IMPERATIVE =
    /^(?:hey[, ]+|hi[, ]+|hello[, ]+|please\s+|can\s+you\s+|could\s+you\s+|would\s+you(?:\s+mind)?\s+|i(?:['’])?d\s+like\s+(?:you\s+to\s+)?|i\s+want\s+(?:you\s+to\s+)?|i\s+need\s+(?:you\s+to\s+)?|maybe\s+|just\s+|also\s+|now\s+)?(?:also\s+|now\s+|just\s+)?/i;

/** Status / capability / definition questions that fairly abstain. */
const NON_ACTION_QUESTION =
    /^(?:hey[, ]+|hi[, ]+|hello[, ]+)?(?:what|which|who|when|where|why|how(?:\s+many|\s+much)?|is\s+(?:it|there|this|that|my|the|bluetooth|wifi|wi-fi|volume|mute|dark\s+mode|notifications?|badges?)\b|are\s+(?:they|these|those|my|the|desktop|notifications?|badges?|taskbar)\b|am\s+i\s+|do\s+i\s+(?:have|need|currently)|does\s+(?:it|this|that|my)\b|did\s+i\b|can\s+i\b|should\s+i\b|would\s+it\b|tell\s+me\s+(?:whether|if|what|which|how|why|where)|explain|describe)\b/i;

/** Underspecified / missing-slot phrasing that should clarify, not fire. */
const MISSING_INFO =
    /\b(which\s+one|which\s+\w+|what\s+(?:file|tab|page|repo|folder|name|id)|not\s+sure\s+which|i(?:['’])?m\s+not\s+sure|missing\s+(?:the\s+)?(?:name|id|url|path)|forgot\s+(?:the\s+)?(?:name|id)|don(?:['’])?t\s+know\s+(?:which|what|where)|please\s+clarify|need\s+(?:more\s+)?(?:info|information|details)|clarif(?:y|ication))\b/i;

/**
 * Partial-constraint / refuse-then-alternate: still requests doing something.
 */
const PARTIAL_CONSTRAINT =
    /\b(?:but|except|without|instead|only|just)\b|\b(?:don(?:['’])?t|do\s+not|never)\b.+\b(?:just|only|instead)\b|\b(?:just|only|instead)\b.+\b(?:open|close|click|search|create|delete|install|send|start|launch|go\s+to|navigate|find|look)\b/i;

const CLAUSE_SPLIT = /[;.—–]|,\s*(?:and|but|then)\s+|\s+—\s+|\s+-\s+/;

function splitCamel(name: string): string[] {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_\-.]+/g, " ")
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length >= 3);
}

function clausesOf(text: string): string[] {
    return text
        .split(CLAUSE_SPLIT)
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
}

function clauseIsNegated(clause: string): boolean {
    return /^(?:hey[, ]+|hi[, ]+|hello[, ]+|please\s+)?(?:don(?:['’])?t|do\s+not|never|stop|avoid|refrain\s+from|leave\b.{0,40}\balone\b)/i.test(
        clause.trim(),
    );
}

function clauseHasActionVp(clause: string): boolean {
    const trimmed = clause.trim();
    // Strip leading polite preface then look for action VP.
    const withoutPreface = trimmed.replace(LEADING_IMPERATIVE, "");
    return ACTION_VP.test(withoutPreface) || ACTION_VP.test(trimmed);
}

/**
 * True when some clause still requests a concrete agent action that is not
 * under negation (refuse-then-alternate / bare imperative).
 */
function hasNonNegatedActionCommand(text: string): boolean {
    for (const clause of clausesOf(text)) {
        if (clauseIsNegated(clause)) continue;
        if (clauseHasActionVp(clause)) return true;
    }
    // Single-clause leading imperative without split points.
    if (clausesOf(text).length === 1) {
        const c = text.trim();
        if (!clauseIsNegated(c) && clauseHasActionVp(c)) {
            // Require imperative-ish framing, not "is open" status.
            if (
                LEADING_IMPERATIVE.test(c) ||
                /^(?:open|close|click|search|go\s+to|navigate|find|look|shut|start|launch|delete|create|install|switch|set|enable|disable|play|send|read|zoom|record|list|show|hide|write|save|load|download|upload|toggle|adjust|increase|decrease|follow|reload|refresh|capture|screenshot|bookmark)\b/i.test(
                    c,
                )
            ) {
                return true;
            }
        }
    }
    return false;
}

function siblingImperativeHit(
    utterance: string,
    siblings: readonly TranslationBenchConfusableSibling[],
): TranslationBenchConfusableSibling | undefined {
    if (!hasNonNegatedActionCommand(utterance)) return undefined;
    const norm = normalizeUtterance(utterance);
    for (const sibling of siblings) {
        const tokens = splitCamel(sibling.actionName);
        const hits = tokens.filter((t) => norm.includes(t));
        if (hits.length >= 1 && tokens.length <= 3) return sibling;
        if (hits.length >= 2) return sibling;
    }
    return undefined;
}

function fail(
    kind: TranslationBenchNegativeKind,
    path: string,
    utterance: string,
    message: string,
    suggestedFix: string,
): TranslationBenchNegativeFairnessResult {
    return { ok: false, kind, path, utterance, message, suggestedFix };
}

function pass(
    kind: TranslationBenchNegativeKind,
    path: string,
    utterance: string,
): TranslationBenchNegativeFairnessResult {
    return { ok: true, kind, path, utterance };
}

/**
 * Classify + validate one negative utterance under empty-gold scoring.
 */
export function checkTranslationBenchNegativeFairness(
    utterance: string,
    target: TranslationBenchTargetAction,
    path: string,
    siblings: readonly TranslationBenchConfusableSibling[] = [],
): TranslationBenchNegativeFairnessResult {
    const text = utterance.trim();
    const hasRefusal = REFUSAL_CUE.test(text);
    const alternateCommand = hasNonNegatedActionCommand(text);
    const missingInfo = MISSING_INFO.test(text);
    const partialConstraint = PARTIAL_CONSTRAINT.test(text);
    const siblingHit = siblingImperativeHit(text, siblings);
    // Require real status/howto/wh- pattern — bare trailing "?" is not enough.
    const isStatusQuestion = NON_ACTION_QUESTION.test(text);

    const targetKey = keyOf(target);
    const rewriteHint =
        `Rewrite as a pure refusal of ${targetKey}, a non-action status/howto ` +
        `question, or a missing-info clarification. Never use contrastive ` +
        `adjacent commands or refuse-then-alternate forms with empty gold.`;

    // Any remaining non-negated agent command → unfair (covers refuse+alternate).
    if (alternateCommand) {
        if (siblingHit !== undefined) {
            return fail(
                "unfair_sibling_command",
                path,
                text,
                `Negative utterance still requests confusable sibling ` +
                    `${keyOf(siblingHit)} while gold is empty. A correct ` +
                    `translator would fire that sibling and be scored FP.`,
                rewriteHint,
            );
        }
        return fail(
            hasRefusal || partialConstraint
                ? "unfair_contrastive"
                : "unfair_imperative",
            path,
            text,
            hasRefusal || partialConstraint
                ? `Negative mixes refusal/constraint language with a concrete ` +
                      `alternate agent command; empty expectedActions is unfair for ` +
                      `${targetKey} under zero-action scoring.`
                : `Negative utterance is a concrete agent command but ` +
                      `expectedActions is []. Under zero-action scoring this labels ` +
                      `a correct translation as a false positive.`,
            rewriteHint,
        );
    }

    // Partial-constraint markers without a clean refuse-only body.
    if (partialConstraint && hasRefusal) {
        // "Don't X; just Y" already caught by alternateCommand. Remaining
        // partial forms with no alternate VP can still be contrastive hedges.
        // Fail closed if "just/only/instead" appears with refusal.
        if (/\b(?:just|only|instead)\b/i.test(text)) {
            return fail(
                "unfair_contrastive",
                path,
                text,
                `Negative uses just/only/instead with refusal language; empty ` +
                    `gold is likely a contrastive adjacent intent for ${targetKey}.`,
                rewriteHint,
            );
        }
    }

    // Pure refusal with no alternate command.
    if (hasRefusal) {
        return pass("pure_refusal", path, text);
    }

    // Missing info / clarification — fair empty gold.
    if (missingInfo) {
        return pass("missing_info", path, text);
    }

    // Non-action status/howto questions — fair empty gold.
    // Reject if the body still embeds an action VP (e.g. "Is there a way to open X?").
    if (isStatusQuestion) {
        if (
            ACTION_VP.test(text) &&
            !/\b(?:currently|enabled|status|how do i|how can i)\b/i.test(text)
        ) {
            // "Is there a way to open google.com?" embeds open → unfair.
            if (
                /\b(?:way to|able to|mind)\b/i.test(text) &&
                ACTION_VP.test(text)
            ) {
                return fail(
                    "unfair_imperative",
                    path,
                    text,
                    `Question still solicits performing an agent action; empty ` +
                        `gold is unfair for ${targetKey}.`,
                    rewriteHint,
                );
            }
        }
        return pass("non_action_question", path, text);
    }

    return fail(
        "unknown",
        path,
        text,
        `Negative utterance is not a fair empty-gold case for ${targetKey}. ` +
            `Could not classify it as pure refusal, non-action question, or missing-info.`,
        rewriteHint,
    );
}

/**
 * Run fairness checks over every negative genCase on a candidate.
 */
export function checkTranslationBenchCandidateNegativeFairness(
    candidate: TranslationBenchGeneratedCandidate,
    target: TranslationBenchTargetAction,
    catalog: readonly TranslationBenchBenchmarkSchema[] = [],
): TranslationBenchReviewIssue[] {
    const siblings =
        catalog.length === 0
            ? []
            : findTranslationBenchConfusableSiblings(target, catalog);
    const issues: TranslationBenchReviewIssue[] = [];

    for (const [index, genCase] of candidate.genCases.entries()) {
        if (genCase.role !== "negative") continue;
        const path = `$.genCases[${index}].utterance`;
        const result = checkTranslationBenchNegativeFairness(
            genCase.utterance,
            target,
            path,
            siblings,
        );
        if (!result.ok) {
            issues.push({
                code: "BAD_NEGATIVE",
                path: result.path,
                message: result.message!,
                suggestedFix: result.suggestedFix!,
            });
        }
    }
    return issues;
}
