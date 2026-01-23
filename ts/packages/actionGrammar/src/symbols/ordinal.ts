// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SymbolConverter, createConverter } from "../symbolModule.js";

/**
 * Ordinal symbol converter
 * Converts ordinal words (first, second, third, ...) to numbers
 */

const ordinalMap: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
    eleventh: 11,
    twelfth: 12,
    thirteenth: 13,
    fourteenth: 14,
    fifteenth: 15,
    sixteenth: 16,
    seventeenth: 17,
    eighteenth: 18,
    nineteenth: 19,
    twentieth: 20,
    "twenty-first": 21,
    "twenty-second": 22,
    "twenty-third": 23,
    "twenty-fourth": 24,
    "twenty-fifth": 25,
    "twenty-sixth": 26,
    "twenty-seventh": 27,
    "twenty-eighth": 28,
    "twenty-ninth": 29,
    thirtieth: 30,
};

function matchOrdinal(token: string): boolean {
    return token.toLowerCase() in ordinalMap;
}

function convertOrdinal(token: string): number | undefined {
    return ordinalMap[token.toLowerCase()];
}

/**
 * Ordinal symbol converter
 * Converts ordinal words to numbers
 */
export const Ordinal: SymbolConverter<number> = createConverter(
    matchOrdinal,
    convertOrdinal,
);

/**
 * Type-safe helper for converting ordinals in agent code
 * @param token The ordinal word to convert
 * @returns The numeric value, or undefined if not a valid ordinal
 *
 * @example
 * const num = convertOrdinalValue("first"); // 1
 * const num2 = convertOrdinalValue("twenty-third"); // 23
 */
export function convertOrdinalValue(token: string): number | undefined {
    return Ordinal.convert(token);
}
