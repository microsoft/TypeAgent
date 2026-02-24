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
    // Multi-word quantity phrases (matched via multi-token entity lookahead)
    "a couple": 2,
    "a pair": 2,
    "a few": 3,
    "several": 4,
    "a handful": 5,
    "half a dozen": 6,
    "a dozen": 12,
    "a score": 20,
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

/**
 * CalendarDate "converter" - validates but preserves original text
 *
 * Unlike other converters that transform values (e.g., ordinal "first" -> 1),
 * CalendarDate PRESERVES the user's original text (e.g., "Friday", "tomorrow").
 *
 * Why? For caching to work:
 * 1. Grammar rules match patterns like "add X $(date:CalendarDate)"
 * 2. If we converted "Friday" -> Date -> ISO string, cache would store "2026-02-13"
 * 3. Future requests with different dates wouldn't match
 *
 * The calendar action handler should do the actual date conversion at execution time.
 */
function convertCalendarDate(token: string): string | undefined {
    // Validate the token is a valid date expression
    if (validateCalendarDate(token)) {
        // Return the original text - let the action handler do the conversion
        return token;
    }
    return undefined;
}

/**
 * CalendarDate entity converter
 * Validates date strings (today, tomorrow, ISO dates, weekdays) but preserves original text
 * Actual date conversion happens in the action handler, not during grammar matching
 */
export const CalendarDate: EntityConverter<string> = createConverter(
    validateCalendarDate,
    convertCalendarDate,
);

// ============================================================================
// CalendarTime Entity
// ============================================================================

/**
 * Parse a single time string to hours and minutes
 * Returns undefined if not a valid time format
 */
function parseTimeToHoursMinutes(
    timeStr: string,
): { hours: number; minutes: number } | undefined {
    const lower = timeStr.toLowerCase().trim();

    // Handle special words
    if (lower === "noon") return { hours: 12, minutes: 0 };
    if (lower === "midnight") return { hours: 0, minutes: 0 };

    // Match patterns: "2pm", "2:30pm", "14:00", "2:30"
    const match = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (match) {
        let hours = parseInt(match[1], 10);
        const minutes = match[2] ? parseInt(match[2], 10) : 0;
        const period = match[3]?.toLowerCase();

        // Validate hours and minutes
        if (hours > 23 || minutes > 59) return undefined;

        // Handle AM/PM
        if (period === "pm" && hours < 12) {
            hours += 12;
        } else if (period === "am" && hours === 12) {
            hours = 0;
        }

        return { hours, minutes };
    }

    return undefined;
}

/**
 * Format hours and minutes as "HH:MM" string
 */
function formatTime(hours: number, minutes: number): string {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function validateCalendarTime(token: string): boolean {
    return parseTimeToHoursMinutes(token) !== undefined;
}

/**
 * Convert time string to canonical "HH:MM" format
 * "2pm" -> "14:00", "noon" -> "12:00", "3:30pm" -> "15:30"
 */
function convertCalendarTime(token: string): string | undefined {
    const parsed = parseTimeToHoursMinutes(token);
    if (parsed) {
        return formatTime(parsed.hours, parsed.minutes);
    }
    return undefined;
}

/**
 * CalendarTime entity converter
 * Validates and converts time strings to canonical "HH:MM" format
 */
export const CalendarTime: EntityConverter<string> = createConverter(
    validateCalendarTime,
    convertCalendarTime,
);

// ============================================================================
// CalendarTimeRange Entity
// ============================================================================

/**
 * Parse a time range string to start and end times
 * Supports: "10-11pm", "2pm to 3pm", "9am-10am", "1-2pm", "2pm-3pm"
 * Returns undefined end for single times
 */
function parseTimeRange(rangeStr: string):
    | {
          start: { hours: number; minutes: number };
          end?: { hours: number; minutes: number };
      }
    | undefined {
    let lower = rangeStr.toLowerCase().trim();

    // Strip "from" prefix if present: "from 1 to 2pm" -> "1 to 2pm"
    if (lower.startsWith("from ")) {
        lower = lower.slice(5);
    }

    // Pattern 1: "10-11pm" or "1-2pm" (shared AM/PM suffix)
    const sharedSuffixMatch = lower.match(
        /^(\d{1,2})(?::(\d{2}))?-(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i,
    );
    if (sharedSuffixMatch) {
        let startHours = parseInt(sharedSuffixMatch[1], 10);
        const startMinutes = sharedSuffixMatch[2]
            ? parseInt(sharedSuffixMatch[2], 10)
            : 0;
        let endHours = parseInt(sharedSuffixMatch[3], 10);
        const endMinutes = sharedSuffixMatch[4]
            ? parseInt(sharedSuffixMatch[4], 10)
            : 0;
        const period = sharedSuffixMatch[5].toLowerCase();

        // Apply AM/PM to both times
        if (period === "pm") {
            if (startHours < 12) startHours += 12;
            if (endHours < 12) endHours += 12;
        } else if (period === "am") {
            if (startHours === 12) startHours = 0;
            if (endHours === 12) endHours = 0;
        }

        return {
            start: { hours: startHours, minutes: startMinutes },
            end: { hours: endHours, minutes: endMinutes },
        };
    }

    // Pattern 2: "2pm to 3pm" or "2pm-3pm" (each time has its own AM/PM)
    const separateMatch = lower.match(
        /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
    );
    if (separateMatch) {
        const startTime = `${separateMatch[1]}${separateMatch[2] ? ":" + separateMatch[2] : ""}${separateMatch[3] || ""}`;
        const endTime = `${separateMatch[4]}${separateMatch[5] ? ":" + separateMatch[5] : ""}${separateMatch[6] || ""}`;

        const start = parseTimeToHoursMinutes(startTime);
        const end = parseTimeToHoursMinutes(endTime);

        if (start && end) {
            return { start, end };
        }
    }

    // Pattern 3: Single time - also valid as a "time range" (just no end time)
    // This allows CalendarTimeRange to match single times like "2pm", "14:00"
    const singleTime = parseTimeToHoursMinutes(rangeStr);
    if (singleTime) {
        return { start: singleTime }; // No end time
    }

    return undefined;
}

function validateCalendarTimeRange(token: string): boolean {
    return parseTimeRange(token) !== undefined;
}

/**
 * Convert time/time-range to canonical format
 * Single time: "2pm" -> "14:00"
 * Time range: "10-11pm" -> "22:00-23:00", "2pm to 3pm" -> "14:00-15:00"
 */
function convertCalendarTimeRange(token: string): string | undefined {
    const parsed = parseTimeRange(token);
    if (parsed) {
        const startStr = formatTime(parsed.start.hours, parsed.start.minutes);
        if (parsed.end) {
            const endStr = formatTime(parsed.end.hours, parsed.end.minutes);
            return `${startStr}-${endStr}`;
        }
        return startStr; // Single time, no range
    }
    return undefined;
}

/**
 * CalendarTimeRange entity converter
 * Validates and converts time range strings to canonical "HH:MM-HH:MM" format
 */
export const CalendarTimeRange: EntityConverter<string> = createConverter(
    validateCalendarTimeRange,
    convertCalendarTimeRange,
);

// ============================================================================
// Percentage Entity
// ============================================================================

function validatePercentage(token: string): boolean {
    const lower = token.toLowerCase().trim();

    // "35%" or "100%"
    if (/^\d+%$/.test(lower)) {
        return true;
    }

    // Bare numbers: "35", "100"
    if (/^\d+$/.test(lower)) {
        return true;
    }

    // Word numbers (reuse cardinal map keys)
    if (lower in cardinalMap) {
        return true;
    }

    return false;
}

function convertPercentage(token: string): number | undefined {
    const lower = token.toLowerCase().trim();

    // "35%" → 35
    if (lower.endsWith("%")) {
        const num = parseInt(lower.slice(0, -1), 10);
        return isNaN(num) ? undefined : num;
    }

    // Bare number: "35" → 35
    const num = parseInt(lower, 10);
    if (!isNaN(num)) {
        return num;
    }

    // Word number: "fifty" → 50 (via cardinal map)
    if (lower in cardinalMap) {
        return cardinalMap[lower];
    }

    return undefined;
}

/**
 * Percentage entity converter
 * Validates and converts percentage expressions: "35%", "100", "twenty"
 */
export const Percentage: EntityConverter<number> = createConverter(
    validatePercentage,
    convertPercentage,
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
    globalEntityRegistry.registerConverter("CalendarTime", CalendarTime);
    globalEntityRegistry.registerConverter(
        "CalendarTimeRange",
        CalendarTimeRange,
    );

    globalEntityRegistry.registerConverter("Percentage", Percentage);

    // Lowercase aliases (paramSpec convention from .pas.json schemas)
    globalEntityRegistry.registerConverter("ordinal", Ordinal);
    globalEntityRegistry.registerConverter("cardinal", Cardinal);
    globalEntityRegistry.registerConverter("calendarDate", CalendarDate);
    globalEntityRegistry.registerConverter("calendarTime", CalendarTime);
    globalEntityRegistry.registerConverter(
        "calendarTimeRange",
        CalendarTimeRange,
    );
    globalEntityRegistry.registerConverter("percentage", Percentage);
}
