// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * INTERNAL TO LIBRARY
 * Common types and methods INTERNAL to the library.
 * These should not be exposed via index.ts
 */

import { conversation as kpLib } from "knowledge-processor";
import { ConversationSettings } from "./conversation.js";
import { ConversationIndex } from "./conversationIndex.js";
import { DateTimeRange } from "./dateTimeSchema.js";
import {
    DateRange,
    IConversation,
    TextLocation,
    TextRange,
} from "./interfaces.js";
import { SearchTerm } from "./interfaces.js";
import {
    IConversationDataWithIndexes,
    ConversationSecondaryIndexes,
    buildTransientSecondaryIndexes,
} from "./secondaryIndexes.js";
import { error, PromptSection, Result, success } from "typechat";

export type Scored<T = any> = {
    item: T;
    score: number;
};

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
    let cmp = x.messageOrdinal - y.messageOrdinal;
    if (cmp !== 0) {
        return cmp;
    }
    cmp = (x.chunkOrdinal ?? 0) - (y.chunkOrdinal ?? 0);
    if (cmp !== 0) {
        return cmp;
    }
    return (x.charOrdinal ?? 0) - (y.charOrdinal ?? 0);
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

export function dateRangeFromDateTimeRange(
    dateTimeRange: DateTimeRange,
): DateRange {
    return {
        start: kpLib.toStartDate(dateTimeRange.startDate),
        end: kpLib.toStopDate(dateTimeRange.stopDate),
    };
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

export function isPromptSection(value: any): value is PromptSection {
    const ps = value as PromptSection;
    return ps.role && ps.content !== undefined;
}

export function flattenResultsArray<T>(results: Result<T>[]): Result<T[]> {
    let data: T[] = [];
    for (const result of results) {
        if (!result.success) {
            return error(result.message);
        }
        data.push(result.data);
    }
    return success(data);
}

//
// String processing
//

export function trimStringLength(
    text: string,
    maxLength: number | undefined,
    trimWhitespace: boolean = true,
): string {
    text = trimWhitespace ? text.trim() : text;
    if (maxLength && text.length > maxLength) {
        return text.slice(0, maxLength);
    }
    return text;
}

/**
 * Ensures that dates are serialized in ISO format, which is more compact
 * @param value
 * @param spaces
 * @returns
 */
export function jsonStringifyForPrompt(value: any, spaces?: number): string {
    const json = JSON.stringify(
        value,
        (key, value) => (value instanceof Date ? value.toISOString() : value),
        spaces,
    );
    return json;
}

export async function createConversationFromData(
    data: IConversationDataWithIndexes,
    conversationSettings: ConversationSettings,
): Promise<IConversation> {
    const conversation: IConversation = {
        nameTag: data.nameTag,
        tags: data.tags,
        messages: data.messages,
        semanticRefs: data.semanticRefs,
        semanticRefIndex: data.semanticIndexData
            ? new ConversationIndex(data.semanticIndexData)
            : undefined,
    };
    const secondaryIndexes = new ConversationSecondaryIndexes(
        conversationSettings,
    );
    conversation.secondaryIndexes = secondaryIndexes;
    if (data.relatedTermsIndexData) {
        secondaryIndexes.termToRelatedTermsIndex.deserialize(
            data.relatedTermsIndexData,
        );
    }
    if (data.messageIndexData) {
        secondaryIndexes.messageIndex!.deserialize(data.messageIndexData);
    }
    await buildTransientSecondaryIndexes(conversation, conversationSettings);
    return conversation;
}

export type Batch<T = any> = {
    startAt: number;
    value: T[];
};
