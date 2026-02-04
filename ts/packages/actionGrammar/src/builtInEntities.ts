// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    EntityConverter,
    createConverter,
    globalEntityRegistry,
} from "./entityRegistry.js";

/**
 * Built-in Entities
 *
 * This module provides standard entity types that can be registered
 * for use in grammars.
 */

// ============================================================================
// Ordinal Entity
// ============================================================================

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

function validateOrdinal(token: string): boolean {
    return token.toLowerCase() in ordinalMap;
}

function convertOrdinal(token: string): number | undefined {
    return ordinalMap[token.toLowerCase()];
}

/**
 * Ordinal entity converter
 * Converts ordinal words (first, second, third, ...) to numbers
 */
export const Ordinal: EntityConverter<number> = createConverter(
    validateOrdinal,
    convertOrdinal,
);

// ============================================================================
// Cardinal Entity
// ============================================================================

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

function validateCardinal(token: string): boolean {
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
 * Cardinal entity converter
 * Converts cardinal words and numeric strings (one, two, "42", ...) to numbers
 */
export const Cardinal: EntityConverter<number> = createConverter(
    validateCardinal,
    convertCardinal,
);

// ============================================================================
// CalendarDate Entity
// ============================================================================

function validateCalendarDate(token: string): boolean {
    const lower = token.toLowerCase();

    // Common date words
    if (["today", "tomorrow", "yesterday"].includes(lower)) {
        return true;
    }

    // ISO date format (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
        return true;
    }

    // Weekday names
    const weekdays = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    ];
    if (weekdays.includes(lower)) {
        return true;
    }

    return false;
}

function convertCalendarDate(token: string): Date | undefined {
    const lower = token.toLowerCase();
    const now = new Date();

    // Handle relative dates
    if (lower === "today") {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    if (lower === "tomorrow") {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    }

    if (lower === "yesterday") {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    }

    // Handle ISO dates
    if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
        // Parse as local date (not UTC) by splitting components
        const parts = token.split("-");
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // Months are 0-indexed
        const day = parseInt(parts[2], 10);
        const date = new Date(year, month, day);
        return isNaN(date.getTime()) ? undefined : date;
    }

    // Handle weekday names (next occurrence)
    const weekdays = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
    ];
    const dayIndex = weekdays.indexOf(lower);
    if (dayIndex !== -1) {
        const currentDay = now.getDay();
        let daysUntil = dayIndex - currentDay;
        if (daysUntil <= 0) {
            daysUntil += 7; // Next week
        }
        return new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + daysUntil,
        );
    }

    return undefined;
}

/**
 * CalendarDate entity converter
 * Converts date strings (today, tomorrow, ISO dates, weekdays) to Date objects
 */
export const CalendarDate: EntityConverter<Date> = createConverter(
    validateCalendarDate,
    convertCalendarDate,
);

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all built-in entities with the global registry
 * Call this before using grammars that reference these entities
 *
 * Registers both PascalCase (grammar convention) and lowercase (paramSpec convention)
 * aliases since the schema's paramSpec uses lowercase but grammars use PascalCase
 */
export function registerBuiltInEntities(): void {
    // PascalCase (grammar convention)
    globalEntityRegistry.registerConverter("Ordinal", Ordinal);
    globalEntityRegistry.registerConverter("Cardinal", Cardinal);
    globalEntityRegistry.registerConverter("CalendarDate", CalendarDate);

    // Lowercase aliases (paramSpec convention from .pas.json schemas)
    globalEntityRegistry.registerConverter("ordinal", Ordinal);
    globalEntityRegistry.registerConverter("cardinal", Cardinal);
    globalEntityRegistry.registerConverter("calendarDate", CalendarDate);
}
