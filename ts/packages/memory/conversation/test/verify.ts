// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { email } from "knowledge-processor";
import * as kp from "knowpro";
import * as tl from "test-lib";
import { conversation as kpLib } from "knowledge-processor";
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

export function verifyEmail(e1: email.Email) {
    // Todo: make this more granular to check every possible field

    expect(e1.from).toBeDefined();
    verifyString(e1.from.address);
    expect(e1.to).toBeDefined();
    expect(e1.to?.length).toBeGreaterThan(0);
    verifyString(e1.subject);
    expect(e1.sentOn).toBeDefined();
    verifyString(e1.body);
}

export function verifyString(value?: string) {
    expect(value).toBeDefined();
    expect(value!.length).toBeGreaterThan(0);
}

export function verifyMessages(
    messages: kp.IMessageCollection,
    expectedMessageCount?: number,
    expectedTagCount?: number,
): void {
    expect(messages.length).toBeGreaterThan(0);
    if (expectedMessageCount !== undefined) {
        expect(messages.length).toEqual(expectedMessageCount);
    }
    for (const message of messages) {
        expect(message).toBeDefined();
        verifyMessageTags(message);
        verifyMessageKnowledge(message);
    }
    if (expectedTagCount !== undefined) {
        expect(getTagCount(messages)).toEqual(expectedTagCount);
    }
}

export function verifyMessageKnowledge(message: kp.IMessage) {
    const knowledge = message.getKnowledge();
    if (knowledge !== undefined) {
        tl.verifyArray(knowledge.entities, true, verifyEntity);
    }
}

export function verifyMessageTags(message: kp.IMessage) {
    if (message.tags !== undefined && message.tags.length > 0) {
        for (const tag of message.tags) {
            if (typeof tag === "string") {
                tl.verifyString(tag);
            } else {
                verifyEntity(tag);
            }
        }
    }
}

export function verifyEntity(entity: kpLib.ConcreteEntity) {
    expect(entity).toBeDefined();
    tl.verifyString(entity.name);
    tl.verifyStringArray(entity.type, true);
    if (entity.facets) {
        tl.verifyArray(entity.facets, true, (facet) => {
            tl.verifyString(facet.name);
            expect(facet.value).toBeDefined();
        });
    }
}

function getTagCount(messages: kp.IMessageCollection): number {
    let counter = 0;
    for (const message of messages) {
        counter += message.tags.length;
    }
    return counter;
}
