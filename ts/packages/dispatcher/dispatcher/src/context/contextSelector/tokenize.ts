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
// context vector so they never dominate a match.
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
    "list",
    "find",
    "search",
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
};

// Split identifier casing/separators into space-delimited words:
// "addItems" -> "add Items", "HTMLParser" -> "HTML Parser", "add_items"/"add-items" -> "add items".
export function deCamelCase(identifier: string): string {
    return identifier
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/[_\-]+/g, " ");
}

// Canonicalize + tokenize. NFKC-normalize, lowercase, extract protected/word
// tokens, then drop stopwords, generic verbs, and sub-minimum-length tokens.
// Deterministic and order-preserving (a caller that needs multiplicity gets it).
export function tokenize(text: string, options?: TokenizeOptions): string[] {
    const dropStopwords = options?.dropStopwords ?? true;
    const dropGenericVerbs = options?.dropGenericVerbs ?? true;
    const minLength = options?.minLength ?? 2;

    if (!text) {
        return [];
    }
    const normalized = text.normalize("NFKC").toLowerCase();
    const re = tokenRegExp();
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
        const token = m[0];
        const isProtected = token.length > 0 && !/^[a-z0-9]+$/.test(token);
        if (!isProtected) {
            if (token.length < minLength) {
                continue;
            }
            if (dropStopwords && STOPWORDS.has(token)) {
                continue;
            }
            if (dropGenericVerbs && GENERIC_VERBS.has(token)) {
                continue;
            }
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
