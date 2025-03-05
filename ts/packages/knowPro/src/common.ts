// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DateRange, TextLocation, TextRange } from "./interfaces.js";
import { SearchTerm } from "./search.js";
/**
 * Common types and methods INTERNAL to the library.
 * Should not be exposed via index.ts
 */
export interface Scored<T = any> {
    item: T;
    score: number;
}
/**
 * Returns:
 *  0 if locations are equal
 *  < 0 if x is less than y
 *  > 0 if x is greater than y
 * @param x
 * @param y
 * @returns
 */

export function compareTextLocation(x: TextLocation, y: TextLocation): number {
    let cmp = x.messageIndex - y.messageIndex;
    if (cmp !== 0) {
        return cmp;
    }
    cmp = (x.chunkIndex ?? 0) - (y.chunkIndex ?? 0);
    if (cmp !== 0) {
        return cmp;
    }
    return (x.charIndex ?? 0) - (y.charIndex ?? 0);
}

export function compareTextRange(x: TextRange, y: TextRange) {
    let cmp = compareTextLocation(x.start, y.start);
    if (cmp !== 0) {
        return cmp;
    }
    if (x.end === undefined && y.end === undefined) {
        return cmp;
    }
    cmp = compareTextLocation(x.end ?? x.start, y.end ?? y.start);
    return cmp;
}

export function isInTextRange(
    outerRange: TextRange,
    innerRange: TextRange,
): boolean {
    // outer start must be <= inner start
    // inner end must be < outerEnd (which is exclusive)
    let cmpStart = compareTextLocation(outerRange.start, innerRange.start);
    if (outerRange.end === undefined && innerRange.end === undefined) {
        // Since both ends are undefined, we have an point location, not a range.
        // Points must be equal
        return cmpStart == 0;
    }
    let cmpEnd = compareTextLocation(
        // innerRange.end must be < outerRange end
        innerRange.end ?? innerRange.start,
        outerRange.end ?? outerRange.start,
    );
    return cmpStart <= 0 && cmpEnd < 0;
}
export function compareDates(x: Date, y: Date): number {
    return x.getTime() - y.getTime();
}

export function isInDateRange(outerRange: DateRange, date: Date): boolean {
    // outer start must be <= date
    // date must be <= outer end
    let cmpStart = compareDates(outerRange.start, date);
    let cmpEnd =
        outerRange.end !== undefined ? compareDates(date, outerRange.end) : -1;
    return cmpStart <= 0 && cmpEnd <= 0;
}
export function isSearchTermWildcard(searchTerm: SearchTerm): boolean {
    return searchTerm.term.text === "*";
}
