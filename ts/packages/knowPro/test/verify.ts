// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextRangeCollection } from "../src/collections.js";
import {
    IConversation,
    KnowledgeType,
    MessageOrdinal,
    ScoredMessageOrdinal,
    SearchTermGroup,
    SearchTermGroupTypes,
    SemanticRef,
    TextRange,
    SemanticRefSearchResult,
} from "../src/interfaces.js";
import { ConversationSearchResult } from "../src/search.js";
import {
    findEntityWithName,
    getSemanticRefsForSearchResult,
    stringify,
} from "./testCommon.js";
import {
    matchPropertySearchTermToEntity,
    matchSearchTermToEntity,
} from "../src/query.js";
import { isPropertyTerm, isSearchGroupTerm } from "../src/compileLib.js";
import { AnswerResponse } from "../src/answerResponseSchema.js";

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
        const message = conversation.messages.get(ordinal.messageOrdinal);
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

function logBadMatch(termGroup: SearchTermGroup, semanticRef: SemanticRef) {
    console.log(
        `Bad match:\n${stringify(termGroup)}\n\n${stringify(semanticRef)}`,
    );
}

export function didEntityDidMatchTerm(
    term: SearchTermGroupTypes,
    semanticRef: SemanticRef,
) {
    if (isPropertyTerm(term)) {
        return matchPropertySearchTermToEntity(term, semanticRef);
    } else if (!isSearchGroupTerm(term)) {
        return matchSearchTermToEntity(term, semanticRef);
    } else {
        throw new Error("Not implemented");
    }
}

export function didSemanticRefDidMatchTerm(
    term: SearchTermGroupTypes,
    semanticRef: SemanticRef,
    kType: KnowledgeType,
) {
    switch (kType) {
        default:
            throw new Error("Not implemented");
            break;
        case "entity":
            return didEntityDidMatchTerm(term, semanticRef);
    }
}

export function verifyDidMatchOneOfTerms(
    termGroup: SearchTermGroup,
    semanticRef: SemanticRef,
    kType: KnowledgeType,
) {
    let didMatch = false;
    for (const term of termGroup.terms) {
        didMatch = didSemanticRefDidMatchTerm(term, semanticRef, kType);
        if (didMatch) {
            break;
        }
    }
    if (!didMatch) {
        logBadMatch(termGroup, semanticRef);
    }
    expect(didMatch).toBeTruthy();
}

export function verifyDidMatchSearchGroup(
    termGroup: SearchTermGroup,
    semanticRef: SemanticRef,
    kType: KnowledgeType,
) {
    switch (termGroup.booleanOp) {
        default:
            throw new Error("Not implemented");
        case "or":
        case "or_max":
            verifyDidMatchOneOfTerms(termGroup, semanticRef, kType);
            break;
    }
}

export function verifySearchResult(result: ConversationSearchResult) {
    expect(result.rawSearchQuery).toBeDefined();
    expect(result.knowledgeMatches.size).toBeGreaterThan(0);
    expect(result.messageMatches.length).toBeGreaterThan(0);
}

export function verifySearchResults(results: ConversationSearchResult[]) {
    expect(results.length).toBeGreaterThan(0);
    for (let i = 0; i < results.length; ++i) {
        verifySearchResult(results[i]);
    }
}

export function verifyAnswerResponse(response: AnswerResponse) {
    expect(response.type).toBeDefined();
    if (response.type === "Answered") {
        expect(response.answer).toBeDefined();
    } else {
        expect(response.whyNoAnswer).toBeDefined();
    }
}
