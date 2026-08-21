// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Small keyword-overlap helpers shared by the catalog selector (catalog.ts) and
// the conceptual-docs selector (docs.ts). Both turn a user question into lower-
// case tokens and score candidate text by how many query tokens it contains.

const STOPWORDS = new Set([
    "the",
    "a",
    "an",
    "to",
    "of",
    "in",
    "on",
    "for",
    "how",
    "do",
    "i",
    "what",
    "whats",
    "is",
    "are",
    "can",
    "could",
    "would",
    "should",
    "my",
    "me",
    "you",
    "your",
    "with",
    "and",
    "or",
    "that",
    "this",
    "please",
    "want",
    "need",
    "get",
    "use",
    "using",
    "command",
    "commands",
    "typeagent",
    "there",
    "does",
    "it",
    "was",
    "were",
    "will",
    "from",
    "by",
    "at",
    "as",
    "be",
    "am",
]);

export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// Distinct query tokens, ready to score against candidate text.
export function queryTokens(question: string): string[] {
    return [...new Set(tokenize(question))];
}

// Count how many of the query tokens appear anywhere in the (lower-cased) text.
export function score(queryTokens: string[], text: string): number {
    let s = 0;
    for (const token of queryTokens) {
        if (text.includes(token)) {
            s++;
        }
    }
    return s;
}
