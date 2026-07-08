// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// A candidate's keyword vector (§6). Flattened — order is ignored, so a set is
// the exact representation (§9: "each candidate's keywords are a set"). Shared by
// the extractor, sidecar, index, and scorer.

export type KeywordVector = ReadonlySet<string>;

export function emptyKeywordVector(): KeywordVector {
    return new Set<string>();
}

// Apply sidecar deltas (§5.1): effective = derived ∪ add − remove, or the
// `replace` escape hatch verbatim. Canonical tokens only (callers tokenize
// before this). Returns a new set; inputs are not mutated.
export function applyKeywordDelta(
    derived: KeywordVector,
    delta:
        | { add?: string[]; remove?: string[]; replace?: string[] }
        | undefined,
): KeywordVector {
    if (delta === undefined) {
        return derived;
    }
    if (delta.replace !== undefined) {
        return new Set(delta.replace);
    }
    const out = new Set(derived);
    for (const k of delta.add ?? []) {
        out.add(k);
    }
    for (const k of delta.remove ?? []) {
        out.delete(k);
    }
    return out;
}
