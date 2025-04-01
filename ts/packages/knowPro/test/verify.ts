// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextRangeCollection } from "../src/collections.js";
import { MessageOrdinal, SemanticRef, TextRange } from "../src/interfaces.js";
import { findEntityWithName } from "./testCommon.js";

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
