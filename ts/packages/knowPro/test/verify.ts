// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextRangeCollection } from "../src/collections.js";
import {
    IConversation,
    MessageOrdinal,
    ScoredMessageOrdinal,
    SemanticRef,
    TextRange,
} from "../src/interfaces.js";
import {
    ConversationSearchResult,
    SemanticRefSearchResult,
} from "../src/search.js";
import {
    findEntityWithName,
    getSemanticRefsForSearchResult,
} from "./testCommon.js";

export function expectHasEntities(
    semanticRefs: SemanticRef[],
    ...entityNames: string[]
) {
    for (const entityName of entityNames) {
        const entity = findEntityWithName(semanticRefs, entityName);
        expect(entity).toBeDefined();
    }
}

export function expectDoesNotHaveEntities(
    semanticRefs: SemanticRef[],
    ...entityNames: string[]
) {
    for (const entityName of entityNames) {
        const entity = findEntityWithName(semanticRefs, entityName);
        expect(entity).toBeUndefined();
    }
}

export function verifyTextRange(range: TextRange): void {
    expect(range.start.messageOrdinal).toBeGreaterThanOrEqual(0);
    if (range.end) {
        expect(range.end.messageOrdinal).toBeGreaterThanOrEqual(
            range.start.messageOrdinal,
        );
    }
}

export function verifyTextRanges(ranges: TextRangeCollection): void {
    expect(ranges.size).toBeGreaterThan(0);
    // Ensure ranges are in order
    let endOrdinalInPrevRange: MessageOrdinal | undefined;
    for (const range of ranges) {
        verifyTextRange(range);
        const endOrdinal = range.end
            ? range.end.messageOrdinal
            : range.start.messageOrdinal;
        if (endOrdinalInPrevRange) {
            expect(endOrdinalInPrevRange).toBeLessThan(endOrdinal);
        }
        endOrdinalInPrevRange = endOrdinal;
    }
}

export function verifyMessageOrdinals(
    conversation: IConversation,
    scoredOrdinals: ScoredMessageOrdinal[],
) {
    for (const ordinal of scoredOrdinals) {
        const message = conversation.messages[ordinal.messageOrdinal];
        expect(message).toBeDefined();
    }
}

export function verifySemanticRefResult(
    matches: SemanticRefSearchResult | undefined,
) {
    expect(matches).toBeDefined();
    if (matches) {
        expect(matches.semanticRefMatches.length).toBeGreaterThan(0);
    }
}

export function resolveAndVerifyKnowledgeMatches(
    conversation: IConversation,
    results: ConversationSearchResult,
) {
    if (results.knowledgeMatches) {
        for (const value of results.knowledgeMatches.values()) {
            resolveAndVerifySemanticRefs(conversation, value);
        }
    }
}

export function resolveAndVerifySemanticRefs(
    conversation: IConversation,
    matches: SemanticRefSearchResult,
) {
    const semanticRefs = getSemanticRefsForSearchResult(conversation, matches);
    expect(semanticRefs).toHaveLength(matches.semanticRefMatches.length);
    expect(semanticRefs).not.toContain(undefined);
    return semanticRefs;
}
