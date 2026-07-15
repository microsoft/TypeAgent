// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Deterministic canonicalizer + tokenizer shared by keyword extraction (§6) and
// the conversation signal (§7). Pinned as part of the determinism contract (§12):
// same input string always yields the same token list, independent of locale,
// Map ordering, or wall-clock. No stemmer in v1 (avoids a heavy NLP dependency
// and a non-deterministic normalization step); parked as a tuning lever.

import { splitCamelCase } from "../../utils/identifier.js";

// Product/language names and spreadsheet refs whose punctuation would otherwise
// be stripped ("C#" -> "c", ".NET" -> "net"). Matched before the generic word
// rule so they survive as whole tokens. Lower-cased forms (input is lowercased
// first). Order within the alternation matters — longer/more-specific first.
const PROTECTED_ALTERNATION = String.raw`c\+\+|objective-c|f#|c#|\.net|[a-z]+[0-9]+:[a-z]+[0-9]+`;

// One token = a protected pattern OR a run of letters/digits. Rebuilt per call
// (RegExp with /g carries lastIndex state — never share a compiled instance).
function tokenRegExp(): RegExp {
    return new RegExp(`${PROTECTED_ALTERNATION}|[a-z0-9]+`, "g");
}

// English stopwords — non-topical glue that never distinguishes a candidate.
const STOPWORDS: ReadonlySet<string> = new Set([
    "a",
    "an",
    "the",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "of",
    "to",
    "in",
    "on",
    "at",
    "by",
    "for",
    "with",
    "from",
    "into",
    "onto",
    "as",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "and",
    "or",
    "but",
    "not",
    "no",
    "yes",
    "do",
    "does",
    "did",
    "done",
    "have",
    "has",
    "had",
    "having",
    "will",
    "would",
    "shall",
    "should",
    "can",
    "could",
    "may",
    "might",
    "must",
    "my",
    "your",
    "our",
    "their",
    "his",
    "her",
    "me",
    "you",
    "we",
    "they",
    "he",
    "she",
    "them",
    "us",
    "i",
    "am",
    "if",
    "then",
    "else",
    "so",
    "than",
    "too",
    "very",
    "just",
    "now",
    "about",
    "over",
    "up",
    "down",
    "out",
    "off",
    "please",
    "let",
    "want",
    "need",
    "some",
    "any",
    "all",
    "each",
    "every",
    "there",
    "here",
    "what",
    "which",
    "who",
    "whom",
    "whose",
    "when",
    "where",
    "why",
    "how",
]);

// Generic CRUD / imperative verbs — present in most action names, so they carry
// no discriminative signal (§6). Dropped from both keyword vectors and the
// context vector so they never dominate a match. Deliberately excludes domain
// nouns that double as verbs (e.g. "list", "search") so an app's own topic word
// survives — this set is a calibration lever (§9), not a fixed truth.
const GENERIC_VERBS: ReadonlySet<string> = new Set([
    "add",
    "create",
    "insert",
    "append",
    "new",
    "make",
    "get",
    "fetch",
    "show",
    "display",
    "find",
    "lookup",
    "query",
    "read",
    "view",
    "open",
    "update",
    "edit",
    "change",
    "modify",
    "set",
    "put",
    "remove",
    "delete",
    "clear",
    "drop",
    "erase",
    "cancel",
    "close",
    "save",
    "store",
    "load",
    "run",
    "start",
    "stop",
    "enable",
    "disable",
    "toggle",
    "select",
    "pick",
    "choose",
    "use",
    "do",
    "perform",
    "execute",
    "action",
]);

export type TokenizeOptions = {
    // Drop English stopwords (default true).
    dropStopwords?: boolean;
    // Drop generic CRUD verbs (default true).
    dropGenericVerbs?: boolean;
    // Minimum token length to keep, protected patterns exempt (default 2).
    minLength?: number;
    // Apply the conservative plural stemmer (default true). Off only for tests
    // that inspect raw tokenization.
    stem?: boolean;
    // Suppress content tokens inside a negation scope (default false). Opt-in so
    // keyword extraction (§6) stays byte-identical; the conversation signal (§7)
    // enables it. See NEGATION_CUES below.
    dropNegatedSpans?: boolean;
};

// Negation-scope handling for the conversation signal (§7). English negation
// ("not the spreadsheet", "no pivot chart") makes the words that follow
// *anti-signal* — the user is rejecting that topic, not requesting it. But the
// cue words are stopwords, dropped before scoring, so the v1 extractor never saw
// the negation and the negated words fired at full weight — the root cause of the
// adversarial loaded-negation misroutes. When `dropNegatedSpans` is on, a scope
// opens at a cue and content tokens inside it are suppressed. The scope closes at
// the next clause boundary (punctuation), a reset connector ("but the config"),
// or the end of the turn — so an idiom like "no problem, open the sheet" keeps
// "sheet" (the comma closes the scope). Purely lexical and deterministic (§12);
// contractions ("don't") are not handled in v1 — a parked lever. Off by default
// so it never touches keyword vectors.
//
// LOCALIZATION (English-only in v1, by design): the cue/reset lexicons below —
// like the plural stemmer above — are ENGLISH. On non-English input the negation
// guard effectively no-ops: negated topics are not suppressed, so loaded-negation
// misroutes can resurface. Localizing this needs per-language cue/reset lexicons
// and locale-aware clause-boundary handling/stemming, keyed off the request or
// session locale.
// TODO(localization): add non-English negation lexicons + locale-aware scoping.
const NEGATION_CUES: ReadonlySet<string> = new Set([
    "not",
    "no",
    "never",
    "without",
    "cannot",
    "nor",
    "none",
    "neither",
]);
const NEGATION_RESETS: ReadonlySet<string> = new Set([
    "but",
    "however",
    "instead",
    "though",
    "although",
    "yet",
    "except",
    "rather",
]);
// Clause punctuation that closes a negation scope, matched in the gap between two
// consecutive tokens (the tokenizer discards punctuation, so it is inspected
// here). The comma/period/etc. must abut whitespace to count — this excludes
// intra-token punctuation that lands in the gap, e.g. a decimal ("2.5"), a time
// ("3:30"), or a version ("v3.2"), whose "." / ":" would otherwise be mistaken
// for a clause break and wrongly reopen the negated span. An em/double dash is a
// clause separator regardless of surrounding spaces.
const CLAUSE_BOUNDARY = /[,.;:!?]\s|\s[,.;:!?]|--|—/;

// Conservative, deterministic plural stemmer (part of the §12 determinism
// contract — pinned, snapshot-tested). It maps common English plurals to their
// singular so a conversation token ("vampires", "coffins", "items") matches a
// singular schema keyword ("vampire", "coffin", "item"). Correctness matters
// only insofar as BOTH the context vector and the keyword vectors pass through
// the same function — consistency, not linguistics. Deliberately narrow to avoid
// over-stemming that would fuse unrelated words; not a full Porter stemmer.
//
// IDEMPOTENT by construction: the single-step rules are applied to a fixed point.
// This matters because callers may canonicalize an already-canonical token (e.g.
// re-loading a committed keyword file); without a fixed point, `-ses` words would
// stem differently on the second pass ("licenses"->"licens"->"licen") and a
// re-canonicalized keyword would stop matching a once-tokenized conversation word.
function stemStep(token: string): string {
    // "boxes"->"box", "dishes"->"dish", "glasses"->"glass", "watches"->"watch".
    if (
        token.length > 4 &&
        (token.endsWith("ses") ||
            token.endsWith("xes") ||
            token.endsWith("zes") ||
            token.endsWith("ches") ||
            token.endsWith("shes"))
    ) {
        return token.slice(0, -2);
    }
    // Plain "-s" plurals: "vampires"->"vampire", "items"->"item", "cells"->"cell",
    // "movies"->"movie". Guard against "ss"/"us"/"is"/"os"/"as" endings (address,
    // status, analysis, this) and keep a >=4 length floor so short tokens aren't
    // mangled. Deliberately no "-ies"->"y" rule: it mangles "-ie" singulars
    // ("movies"->"movy", "series"->"sery"), and plain "-s" already yields the
    // correct "movie"/"serie" — consistency between both sides is what matters.
    if (
        token.length > 3 &&
        token.endsWith("s") &&
        !/(ss|us|is|os|as)$/.test(token)
    ) {
        return token.slice(0, -1);
    }
    return token;
}

export function stem(token: string): string {
    // Never touch protected patterns (they aren't pure [a-z0-9]).
    if (!/^[a-z0-9]+$/.test(token)) {
        return token;
    }
    // Apply the step rules to a fixed point so stem() is idempotent.
    let current = token;
    let next = stemStep(current);
    while (next !== current) {
        current = next;
        next = stemStep(current);
    }
    return current;
}

// Split identifier casing/separators into space-delimited words:
// "addItems" -> "add Items", "HTMLParser" -> "HTML Parser", "add_items"/"add-items" -> "add items".
export function deCamelCase(identifier: string): string {
    return splitCamelCase(identifier).replace(/[_\-]+/g, " ");
}

type ResolvedTokenizeOptions = {
    dropStopwords: boolean;
    dropGenericVerbs: boolean;
    minLength: number;
    applyStem: boolean;
    dropNegatedSpans: boolean;
};

function resolveTokenizeOptions(
    options?: TokenizeOptions,
): ResolvedTokenizeOptions {
    return {
        dropStopwords: options?.dropStopwords ?? true,
        dropGenericVerbs: options?.dropGenericVerbs ?? true,
        minLength: options?.minLength ?? 2,
        applyStem: options?.stem ?? true,
        dropNegatedSpans: options?.dropNegatedSpans ?? false,
    };
}

// True when a stemmed word token should be dropped by the length/vocabulary
// filters (order matches the original inline checks).
function isDroppedWord(token: string, opts: ResolvedTokenizeOptions): boolean {
    if (token.length < opts.minLength) {
        return true;
    }
    if (opts.dropStopwords && STOPWORDS.has(token)) {
        return true;
    }
    if (opts.dropGenericVerbs && GENERIC_VERBS.has(token)) {
        return true;
    }
    return false;
}

// Classify one raw regex match into the token to emit, or undefined to skip it.
// Protected (non-[a-z0-9]) tokens bypass stemming and the vocabulary filters.
// Negation cues/resets mutate `neg` and are themselves dropped; `neg.active` is
// only consulted when negation-span suppression is enabled.
function classifyToken(
    raw: string,
    opts: ResolvedTokenizeOptions,
    neg: { active: boolean },
): string | undefined {
    const isProtected = raw.length > 0 && !/^[a-z0-9]+$/.test(raw);
    if (isProtected) {
        return opts.dropNegatedSpans && neg.active ? undefined : raw;
    }
    const token = opts.applyStem ? stem(raw) : raw;
    // Negation cues/resets are inspected before the vocabulary drops because the
    // cues ("not", "no") are themselves stopwords.
    if (opts.dropNegatedSpans) {
        if (NEGATION_CUES.has(token)) {
            neg.active = true;
            return undefined;
        }
        if (neg.active && NEGATION_RESETS.has(token)) {
            neg.active = false;
            return undefined;
        }
    }
    if (isDroppedWord(token, opts)) {
        return undefined;
    }
    if (opts.dropNegatedSpans && neg.active) {
        return undefined;
    }
    return token;
}

// Canonicalize + tokenize. NFKC-normalize, lowercase, extract protected/word
// tokens, stem plurals, then drop stopwords, generic verbs, and sub-minimum-
// length tokens. Deterministic and order-preserving (a caller that needs
// multiplicity gets it). Stemming runs before the vocabulary checks so that
// inflected generic verbs ("removes" -> "remove") are still dropped.
export function tokenize(text: string, options?: TokenizeOptions): string[] {
    if (!text) {
        return [];
    }
    const opts = resolveTokenizeOptions(options);
    const normalized = text.normalize("NFKC").toLowerCase();
    const re = tokenRegExp();
    const out: string[] = [];
    const neg = { active: false };
    let prevEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
        // A negation scope closes at the first clause boundary (punctuation) in
        // the untokenized gap before this token.
        if (
            opts.dropNegatedSpans &&
            neg.active &&
            CLAUSE_BOUNDARY.test(normalized.slice(prevEnd, m.index))
        ) {
            neg.active = false;
        }
        prevEnd = re.lastIndex;
        const emitted = classifyToken(m[0], opts, neg);
        if (emitted !== undefined) {
            out.push(emitted);
        }
    }
    return out;
}

// Convenience: tokenize an identifier (de-camel first). Used by the keyword
// extractor for action/parameter names.
export function tokenizeIdentifier(
    identifier: string,
    options?: TokenizeOptions,
): string[] {
    return tokenize(deCamelCase(identifier), options);
}

// Test hooks / callers that want to inspect the pinned vocabularies.
export function isStopword(token: string): boolean {
    return STOPWORDS.has(token);
}

export function isGenericVerb(token: string): boolean {
    return GENERIC_VERBS.has(token);
}
