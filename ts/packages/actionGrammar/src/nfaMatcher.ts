// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { Grammar } from "./grammarTypes.js";
import { NFA } from "./nfa.js";
import {
    matchNFAWithIndex,
    buildFirstTokenIndex,
    sortNFAMatches,
    type FirstTokenIndex,
} from "./nfaInterpreter.js";
import { applySplitToTokens } from "./tokenSplit.js";
import { matchNFACharBased } from "./nfaInterpreterChar.js";

// Lazy-built, NFA-lifetime cache: one index per NFA object.
const indexCache = new WeakMap<NFA, FirstTokenIndex>();
function getIndex(nfa: NFA): FirstTokenIndex {
    let idx = indexCache.get(nfa);
    if (!idx) {
        idx = buildFirstTokenIndex(nfa);
        indexCache.set(nfa, idx);
    }
    return idx;
}

const debug = registerDebug("typeagent:actionGrammar:nfaMatcher");

/**
 * NFA-based Grammar Matcher
 *
 * High-level API for matching request strings against compiled grammars using NFA.
 * This module bridges the NFA interpreter with the Grammar structure to produce
 * action objects compatible with the existing grammar matching system.
 */

/**
 * Match result compatible with the old grammar matcher format
 */
export interface NFAGrammarMatchResult {
    match: unknown; // The action object with actionName and parameters
    matchedValueCount: number;
    wildcardCharCount: number;
    entityWildcardPropertyNames: string[];
}

/**
 * Strip trailing punctuation from a token (linear time).
 *
 * Punctuation-only tokens (e.g. `"..."`, `"!?"`) are PRESERVED — the strip is
 * meant to remove incidental trailing punctuation on word-bearing tokens
 * (`"hello,"` → `"hello"`), not to eliminate keywords that are themselves
 * punctuation segments.  Without this guard, grammar `... done` would
 * normalize to just `done`.
 */
function stripTrailingPunctuation(token: string): string {
    const punctuation = "?!.,;:";
    let end = token.length;
    while (end > 0 && punctuation.includes(token[end - 1])) {
        end--;
    }
    if (end === 0) {
        // Token is all punctuation — return as-is.
        return token;
    }
    return end === token.length ? token : token.slice(0, end);
}

/**
 * Normalize a single token for NFA matching: lowercase, trim outer whitespace,
 * and strip trailing sentence punctuation.  Applied to both input tokens and
 * grammar tokens so that both sides of the comparison are on the same
 * canonical form.
 *
 * The outer-whitespace trim handles grammar segments produced by escape-space
 * authoring (`hello\ world` produces segments `["hello", " world"]`); without
 * the trim the literal leading space prevents the segment from matching the
 * whitespace-stripped input token "world".  Input tokens come from `\S+` so
 * never have outer whitespace, making the trim a no-op for input.
 */
export function normalizeToken(token: string): string {
    return stripTrailingPunctuation(token.trim().toLowerCase());
}

// Number token recognition — mirrors the canonical regex in grammarMatcher.ts
// (matchNumberPartRegexp).  Accepts:
//   - Octal:  0o[0-7]+
//   - Hex:    0x[0-9a-f]+
//   - Binary: 0b[01]+
//   - Decimal with optional sign, fraction, and positive exponent
const numberTokenRegExp =
    /^(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)$/i;

/**
 * Parse a single token as a JavaScript number, accepting the same extended
 * formats the canonical grammarMatcher recognizes (octal `0o…`, hex `0x…`,
 * binary `0b…`, plus signed decimal with optional fraction/exponent).
 *
 * Returns the parsed `number`, or `undefined` if the token isn't a recognized
 * numeric literal.  Unlike `parseFloat`, this rejects partial matches and
 * understands the non-decimal prefixes.
 */
export function parseNumberToken(token: string): number | undefined {
    if (!numberTokenRegExp.test(token)) {
        return undefined;
    }
    const n = Number(token);
    return Number.isNaN(n) ? undefined : n;
}

/**
 * Tokenize a request string into an array of tokens.
 * Splits on whitespace and strips trailing punctuation, but preserves
 * original case so that wildcard captures retain the user's casing.
 * Normalization (lowercasing) for fixed-token comparisons is done
 * separately at match time via normalizeToken().
 */
export function tokenizeRequest(request: string): string[] {
    return request
        .trim()
        .split(/\s+/)
        .map(stripTrailingPunctuation)
        .filter((token) => token.length > 0);
}

/**
 * Tokenize a request string while also recording each token's character
 * offsets in the original (untrimmed) input.  Used by completion to compute
 * `matchedPrefixLength` — the canonical matcher tracks this directly in chars;
 * the NFA/DFA need to reconstruct it from token positions.
 *
 * `tokens[i]` is the *normalized* token (trailing sentence punctuation
 * stripped) — what the matcher compares.
 * `starts[i]` is the offset where the raw (pre-strip) match begins.
 * `ends[i]` is the offset just past the raw match — i.e., it INCLUDES the
 * trailing punctuation if any.  Canonical's `matchedPrefixLength` advances
 * through trailing punctuation when the grammar token itself contains it
 * (e.g. keyword `set:`), so we report the raw end here.
 */
export function tokenizeRequestWithOffsets(request: string): {
    tokens: string[];
    starts: number[];
    ends: number[];
} {
    const tokens: string[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    const re = /\S+/g;
    for (const m of request.matchAll(re)) {
        const raw = m[0];
        const stripped = stripTrailingPunctuation(raw);
        if (stripped.length === 0) continue;
        const start = m.index ?? 0;
        tokens.push(stripped);
        starts.push(start);
        ends.push(start + raw.length);
    }
    return { tokens, starts, ends };
}

// ---------------------------------------------------------------------------
// Token pre-splitting for optional/auto spacing mode
// ---------------------------------------------------------------------------

/**
 * Collect all split candidates stored on NFA rule entry states.
 * Only states from optional/auto rules carry splitCandidates (set by the
 * compiler).  Returns candidates sorted longest-first, ready for greedy scan.
 */
function collectNFASplitCandidates(nfa: NFA): string[] {
    const candidates = new Set<string>();
    for (const state of nfa.states) {
        if (state.splitCandidates) {
            for (const c of state.splitCandidates) {
                candidates.add(c);
            }
        }
    }
    return Array.from(candidates).sort((a, b) => b.length - a.length);
}

// splitToken and applySplitToTokens are imported from tokenSplit.ts

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Match a request string against a grammar using NFA
 *
 * Two-pass strategy for spacing modes:
 *   Pass 1 — original whitespace tokens: correct for spacing=required rules.
 *   Pass 2 — pre-split tokens (only when the NFA has optional/auto rules with
 *             split candidates): handles fused tokens like "Swift's" or "黃色汽車".
 * The higher-priority result across both passes is returned.
 *
 * @param _grammar The grammar structure (unused, kept for API compatibility)
 * @param nfa The compiled NFA
 * @param request The request string to match
 * @returns Array of grammar match results, sorted by priority
 */
/**
 * Per-call options for NFA grammar matching.
 *
 * `charBased: true` routes through the char-based experimental matcher
 * (Phase 1 of nfa-char-based-rewrite plan).  Off by default — the
 * production path uses the token-based matcher.
 */
export interface NFAMatchOptions {
    charBased?: boolean;
}

export function matchGrammarWithNFA(
    _grammar: Grammar,
    nfa: NFA,
    request: string,
    opts?: NFAMatchOptions,
): NFAGrammarMatchResult[] {
    if (opts?.charBased) {
        const result = matchNFACharBased(nfa, request);
        if (!result.matched) return [];
        const matchedRule =
            result.ruleIndex !== undefined
                ? _grammar.alternatives[result.ruleIndex]
                : undefined;
        // No `spacing=none` outer-whitespace post-check here: the char
        // matcher's leading regex (none → empty separator) already
        // rejects leading whitespace at charPos=0, and `tryAccept`
        // already rejects unconsumed trailing whitespace at the
        // outermost rule.  A coarse `request.trim()` check would also
        // mis-reject grammars whose literals END with an escape-space
        // segment (the match span legitimately consumed the trailing
        // space).  Cluster D fix.
        const hasExplicitValue = matchedRule?.value !== undefined;
        const actionObject = hasExplicitValue
            ? result.actionValue
            : (result.actionValue ?? request);
        return [
            {
                match: actionObject,
                matchedValueCount:
                    result.fixedStringPartCount +
                    result.checkedWildcardCount +
                    result.uncheckedWildcardCount,
                wildcardCharCount: result.uncheckedWildcardCount,
                entityWildcardPropertyNames: [],
            },
        ];
    }
    const tokens = tokenizeRequest(request);
    // Positional context for multi-input-token separator validation.  Only
    // the original-token pass uses it; pre-split tokens have synthetic
    // boundaries that don't correspond to the raw input.
    const offsets = tokenizeRequestWithOffsets(request);
    const inputCtx = {
        request,
        starts: offsets.starts,
        ends: offsets.ends,
    };

    debug(`Tokenized: [${tokens.join(", ")}] (${tokens.length} tokens)`);

    if (tokens.length === 0) {
        return [];
    }

    // Canonical matcher rejects leading/trailing whitespace under spacing=none
    // via the regex prefix (leadingIsNone) and finalizeState's trailing check
    // (grammarMatcher.ts:632-644).  In the token-based NFA path, tokenizer trim
    // erases that signal before matching ever starts — mirror the rejection
    // here, gated on the matched rule's spacing mode.  Leading/trailing
    // *punctuation* is left to the in-grammar tokens to match or not match;
    // pure whitespace at the edges is the case the tokenizer alone can't
    // recover.
    const hasOuterWhitespace =
        request.length !== request.trim().length && request.trim().length > 0;

    const index = getIndex(nfa);

    // Pass 1: original token array (handles spacing=required correctly)
    const origResult = matchNFAWithIndex(nfa, index, tokens, false, inputCtx);

    // Pass 2: pre-split fused tokens for optional/auto rules
    let bestResult = origResult;
    const splitCandidates = collectNFASplitCandidates(nfa);
    const splitTokens = applySplitToTokens(tokens, splitCandidates);
    if (splitTokens !== null) {
        debug(
            `Split tokens: [${splitTokens.join(", ")}] (${splitTokens.length} tokens)`,
        );
        const splitResult = matchNFAWithIndex(nfa, index, splitTokens);
        if (splitResult.matched) {
            if (!origResult.matched) {
                bestResult = splitResult;
            } else {
                [bestResult] = sortNFAMatches([origResult, splitResult]);
            }
        }
    }

    if (!bestResult.matched) {
        debug(`Match result: NO MATCH`);
        return [];
    }

    // spacing=none + outer whitespace: reject (see comment near tokenization).
    if (hasOuterWhitespace && bestResult.ruleIndex !== undefined) {
        const matchedRule = _grammar.alternatives[bestResult.ruleIndex];
        if (matchedRule?.spacingMode === "none") {
            debug(
                `Match rejected: rule ${bestResult.ruleIndex} is spacing=none but request has leading/trailing whitespace`,
            );
            return [];
        }
    }

    debug(`Match result: MATCHED`);
    debug(`Action value: %O`, bestResult.actionValue);

    // If the matched rule has an explicit `-> value` expression, return
    // the evaluated value (even when it's undefined — e.g. an unset
    // optional variable).  Otherwise default to the request string.
    const matchedRule =
        bestResult.ruleIndex !== undefined
            ? _grammar.alternatives[bestResult.ruleIndex]
            : undefined;
    const hasExplicitValue = matchedRule?.value !== undefined;
    const actionObject = hasExplicitValue
        ? bestResult.actionValue
        : (bestResult.actionValue ?? request);
    const wildcardCharCount = bestResult.uncheckedWildcardCount;
    const entityWildcardPropertyNames: string[] = [];

    return [
        {
            match: actionObject,
            matchedValueCount:
                bestResult.fixedStringPartCount +
                bestResult.checkedWildcardCount +
                bestResult.uncheckedWildcardCount,
            wildcardCharCount,
            entityWildcardPropertyNames,
        },
    ];
}
