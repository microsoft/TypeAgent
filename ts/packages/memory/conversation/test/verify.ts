// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { email } from "knowledge-processor";
import * as kp from "knowpro";
import { EmailMessage } from "../src/emailMessage.js";

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

export function verifyConversationBasic(
    conversation: kp.IConversation,
    expectedMessageCount: number,
    expectedSemanticRefCount?: number,
) {
    expect(conversation.messages.length).toEqual(expectedMessageCount);
    expect(conversation.semanticRefs).toBeDefined();
    expect(conversation.semanticRefs!.length).toBeGreaterThan(0);
    if (expectedSemanticRefCount && expectedSemanticRefCount > 0) {
        expect(conversation.semanticRefs).toHaveLength(
            expectedSemanticRefCount,
        );
    }
}

export function verifyEmailAddressEqual(
    a1: email.EmailAddress,
    a2: email.EmailAddress,
) {
    expect(a1.address).toEqual(a2.address);
    expect(a1.displayName).toEqual(a2.displayName);
}

export function verifyEmailHeadersEqual(
    e1: email.EmailHeader,
    e2: email.EmailHeader,
): void {
    verifyEmailAddressEqual(e1.from, e2.from);
}

export function verifyMessagesEqual(m1: EmailMessage[], m2: EmailMessage[]) {
    expect(m1).toHaveLength(m2.length);
    for (let i = 0; i < m1.length; ++i) {
        verifyEmailHeadersEqual(m1[i].metadata, m2[i].metadata);
    }
}
