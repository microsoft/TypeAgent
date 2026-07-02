// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Deterministic canonicalizer + tokenizer shared by keyword extraction (§6) and
// the conversation signal (§7). Pinned as part of the determinism contract (§12):
// same input string always yields the same token list, independent of locale,
// Map ordering, or wall-clock. No stemmer in v1 (avoids a heavy NLP dependency
// and a non-deterministic normalization step); parked as a tuning lever.

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
};

// Conservative, deterministic plural stemmer (part of the §12 determinism
// contract — pinned, snapshot-tested). It maps common English plurals to their
// singular so a conversation token ("vampires", "coffins", "items") matches a
// singular schema keyword ("vampire", "coffin", "item"). Correctness matters
// only insofar as BOTH the context vector and the keyword vectors pass through
// the same function — consistency, not linguistics. Deliberately narrow to avoid
// over-stemming that would fuse unrelated words; not a full Porter stemmer.
export function stem(token: string): string {
    // Never touch protected patterns (they aren't pure [a-z0-9]).
    if (!/^[a-z0-9]+$/.test(token)) {
        return token;
    }
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

// Split identifier casing/separators into space-delimited words:
// "addItems" -> "add Items", "HTMLParser" -> "HTML Parser", "add_items"/"add-items" -> "add items".
export function deCamelCase(identifier: string): string {
    return identifier
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/[_\-]+/g, " ");
}

// Canonicalize + tokenize. NFKC-normalize, lowercase, extract protected/word
// tokens, stem plurals, then drop stopwords, generic verbs, and sub-minimum-
// length tokens. Deterministic and order-preserving (a caller that needs
// multiplicity gets it). Stemming runs before the vocabulary checks so that
// inflected generic verbs ("removes" -> "remove") are still dropped.
export function tokenize(text: string, options?: TokenizeOptions): string[] {
    const dropStopwords = options?.dropStopwords ?? true;
    const dropGenericVerbs = options?.dropGenericVerbs ?? true;
    const minLength = options?.minLength ?? 2;
    const applyStem = options?.stem ?? true;

    if (!text) {
        return [];
    }
    const normalized = text.normalize("NFKC").toLowerCase();
    const re = tokenRegExp();
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
        const raw = m[0];
        const isProtected = raw.length > 0 && !/^[a-z0-9]+$/.test(raw);
        if (isProtected) {
            out.push(raw);
            continue;
        }
        const token = applyStem ? stem(raw) : raw;
        if (token.length < minLength) {
            continue;
        }
        if (dropStopwords && STOPWORDS.has(token)) {
            continue;
        }
        if (dropGenericVerbs && GENERIC_VERBS.has(token)) {
            continue;
        }
        out.push(token);
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
