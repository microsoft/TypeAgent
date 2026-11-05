// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ITermToSemanticRefIndexData,
    ScoredSemanticRefOrdinal,
} from "./interfaces.js";

export type TermNormalizationVersion = 1 | 2;
export const currentTermNormalizationVersion = 2;

export function validateTermNormalizationVersion(
    version: number,
): TermNormalizationVersion {
    if (version !== 1 && version !== 2)
        throw new Error(
            `Unsupported search-term normalization version ${version}`,
        );
    return version;
}

export function normalizeSearchTerm(
    term: string,
    version: TermNormalizationVersion = currentTermNormalizationVersion,
): string {
    validateTermNormalizationVersion(version);
    if (version === 1) return term.toLowerCase();
    return term
        .replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "")
        .toLowerCase()
        .normalize("NFC")
        .replace(/\p{White_Space}+/gu, " ");
}

export function migrateSearchTermPostings(
    data: ITermToSemanticRefIndexData,
): ITermToSemanticRefIndexData {
    validateTermNormalizationVersion(data.normalizationVersion ?? 1);
    const terms = new Map<string, Map<number, ScoredSemanticRefOrdinal>>();
    for (const item of data.items) {
        const term = normalizeSearchTerm(item.term);
        if (!term) throw new Error("Retained search term normalizes to empty");
        const postings =
            terms.get(term) ?? new Map<number, ScoredSemanticRefOrdinal>();
        for (const posting of item.semanticRefOrdinals) {
            const previous = postings.get(posting.semanticRefOrdinal);
            if (!previous || previous.score < posting.score)
                postings.set(posting.semanticRefOrdinal, { ...posting });
        }
        terms.set(term, postings);
    }
    return {
        normalizationVersion: currentTermNormalizationVersion,
        items: [...terms].map(([term, postings]) => ({
            term,
            semanticRefOrdinals: [...postings.values()],
        })),
    };
}
