// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Free-form name → safe identifier helpers.
//
// User-facing flow names ("displayName") are arbitrary text. Internal
// "actionName" must be a valid TS identifier + grammar rule name + dispatcher
// route key. This module bridges the two.
//
// Three responsibilities:
//   - tokenizeForTriggerPhrase — split arbitrary text into lowercased word
//     tokens (used by both slug generation and grammar trigger phrases).
//   - slugifyFlowName — produce a guaranteed-safe identifier.
//   - resolveUniqueActionName — disambiguate against existing flows + an
//     injected reserved-name set, appending `Flow` and/or numeric suffixes.

// Max length of an auto-derived actionName. Above this we truncate.
const MAX_ACTION_NAME_LENGTH = 60;

// Split a name into lowercase word tokens via non-alphanumeric runs and
// camelCase boundaries. Strips diacritics; non-ASCII letters (CJK, etc.)
// are dropped — callers fall back to `unnamedFlow` for those.
//
//   "boldTest"          → ["bold", "test"]
//   "My Favorite Chart" → ["my", "favorite", "chart"]
//   "HTMLParser"        → ["html", "parser"]
//   "naïve"             → ["naive"]
//   "___"               → []
export function tokenizeForTriggerPhrase(name: string): string[] {
    const cleaned = name.normalize("NFD").replace(/\p{M}/gu, "");
    const segments = cleaned.split(/[^A-Za-z0-9]+/).filter((s) => s.length > 0);
    const tokens: string[] = [];
    for (const seg of segments) {
        const parts = seg
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
            .split(/\s+/)
            .filter((p) => p.length > 0);
        tokens.push(...parts);
    }
    return tokens.map((t) => t.toLowerCase());
}

// Convert a free-form displayName into a safe camelCase actionName for use
// as a TS identifier + grammar rule. Tokenize → camelCase → "flow" prefix
// if leading digit → truncate. Empty/symbolic input → "unnamedFlow".
// Not guaranteed unique — pass through `resolveUniqueActionName()`.
export function slugifyFlowName(displayName: string): string {
    const tokens = tokenizeForTriggerPhrase(displayName);
    if (tokens.length === 0) return "unnamedFlow";

    let slug = tokens
        .map((t, i) => (i === 0 ? t : t.charAt(0).toUpperCase() + t.slice(1)))
        .join("");

    if (/^[0-9]/.test(slug)) {
        slug = "flow" + slug.charAt(0).toUpperCase() + slug.slice(1);
    }

    if (slug.length > MAX_ACTION_NAME_LENGTH) {
        slug = slug.slice(0, MAX_ACTION_NAME_LENGTH);
    }

    return slug;
}

// Disambiguate a desired actionName against existing flows + reserved names.
// Reserved → try `${desired}Flow` first. Collisions get a numeric suffix
// starting at 2 (`${candidate}2`, `${candidate}3`, ...). Suffix is appended
// AFTER any Flow suffix → `${name}Flow2`, not `${name}2Flow`.
//
// `isReserved` defaults to "nothing is reserved"; pass an agent-specific
// predicate to guard against built-in action-name collisions.
export function resolveUniqueActionName(
    desired: string,
    existing: ReadonlySet<string>,
    isReserved: (name: string) => boolean = () => false,
): string {
    let base = desired;
    if (isReserved(base)) {
        base = base + "Flow";
    }
    if (!existing.has(base) && !isReserved(base)) {
        return base;
    }
    let i = 2;
    while (existing.has(`${base}${i}`) || isReserved(`${base}${i}`)) {
        i++;
    }
    return `${base}${i}`;
}
