// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SymbolConverter, createConverter } from "../symbolModule.js";

/**
 * Cardinal symbol converter
 * Converts cardinal number words (one, two, three, ...) to numbers
 */

const cardinalMap: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    "twenty-one": 21,
    "twenty-two": 22,
    "twenty-three": 23,
    "twenty-four": 24,
    "twenty-five": 25,
    "twenty-six": 26,
    "twenty-seven": 27,
    "twenty-eight": 28,
    "twenty-nine": 29,
    thirty: 30,
};

function matchCardinal(token: string): boolean {
    const lower = token.toLowerCase();
    // Match word numbers or numeric strings
    return lower in cardinalMap || /^\d+$/.test(token);
}

function convertCardinal(token: string): number | undefined {
    const lower = token.toLowerCase();
    // Try word mapping first
    if (lower in cardinalMap) {
        return cardinalMap[lower];
    }
    // Try parsing as number
    const num = parseInt(token, 10);
    return isNaN(num) ? undefined : num;
}

/**
 * Cardinal symbol converter
 * Converts cardinal words and numeric strings to numbers
 */
export const Cardinal: SymbolConverter<number> = createConverter(
    matchCardinal,
    convertCardinal,
);

/**
 * Type-safe helper for converting cardinals in agent code
 * @param token The cardinal word or number string to convert
 * @returns The numeric value, or undefined if not a valid cardinal
 *
 * @example
 * const num = convertCardinalValue("five"); // 5
 * const num2 = convertCardinalValue("42"); // 42
 */
export function convertCardinalValue(token: string): number | undefined {
    return Cardinal.convert(token);
}
