// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";

export function verifyNoIndexingErrors(results: kp.IndexingResults) {
    verifyNoTextIndexingError(results.semanticRefs);
    verifyNoTextIndexingError(results.secondaryIndexResults?.message);
    verifyNoTextIndexingError(results.secondaryIndexResults?.properties);
    verifyNoTextIndexingError(results.secondaryIndexResults?.relatedTerms);
    verifyNoTextIndexingError(results.secondaryIndexResults?.timestamps);
}

export function verifyNoTextIndexingError(
    result: kp.TextIndexingResult | undefined,
) {
    expect(result).toBeDefined();
    if (result?.error) {
        console.log(`Text indexing error ${result.error}`);
    }
    expect(result?.error).toBeUndefined();
}

export function verifyCompletedUpto(
    upto: kp.TextLocation | undefined,
    expectedUpto: number,
): void {
    expect(upto).toBeDefined();
    if (upto) {
        expect(upto.messageOrdinal).toEqual(expectedUpto);
    }
}

export function verifyNumberCompleted(
    numberCompleted: number | undefined,
    expected: number,
): void {
    expect(numberCompleted).toBeDefined();
    if (numberCompleted) {
        expect(numberCompleted).toEqual(expected);
    }
}

export function verifyTermsInSemanticIndex(
    terms: IterableIterator<string> | string[],
    index: kp.ITermToSemanticRefIndex,
) {
    for (let term of terms) {
        term = term.toLowerCase().trim();
        const postings = index.lookupTerm(term);
        expect(postings).toBeDefined();
        if (postings) {
            expect(postings.length).toBeGreaterThan(0);
        }
    }
}
