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
    several: 4,
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

// Weekday name list (index = getDay() value, Sunday=0)
const WEEKDAYS = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
];

/**
 * Resolve a date-expression text to a Date.
 * Supports: "today", "tomorrow", "yesterday", weekday names, ISO YYYY-MM-DD.
 */
function resolveDateFromText(text: string): Date {
    const lower = text.toLowerCase().trim();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (lower === "today") return today;

    if (lower === "yesterday") {
        const d = new Date(today);
        d.setDate(d.getDate() - 1);
        return d;
    }

    if (lower === "tomorrow") {
        const d = new Date(today);
        d.setDate(d.getDate() + 1);
        return d;
    }

    // ISO date YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return new Date(text);
    }

    // Weekday name — find upcoming occurrence (could be today)
    const wdIdx = WEEKDAYS.indexOf(lower);
    if (wdIdx >= 0) {
        const d = new Date(today);
        const diff = (wdIdx - d.getDay() + 7) % 7;
        d.setDate(d.getDate() + diff);
        return d;
    }

    return today; // fallback
}

/**
 * Rich value returned by the CalendarDate entity converter.
 *
 * The converter preserves the user's original text (e.g. "Friday", "tomorrow")
 * for caching correctness. The actual date is resolved lazily when accessed.
 */
export class CalendarDateValue {
    readonly text: string;
    private _date: Date | undefined;

    constructor(text: string) {
        this.text = text;
    }

    /** Returns the original user text (for backward compatibility with string slot values) */
    toString(): string {
        return this.text;
    }

    /** Resolves to an absolute Date (lazy, cached) */
    asDate(): Date {
        if (!this._date) {
            this._date = resolveDateFromText(this.text);
        }
        return this._date;
    }

    /** Returns ISO 8601 string for the resolved date */
    asISO(): string {
        return this.asDate().toISOString();
    }

    /** Returns ISO day-start (00:00:00) string */
    asISODayStart(): string {
        const d = new Date(this.asDate());
        d.setHours(0, 0, 0, 0);
        return d.toISOString();
    }

    /** Returns ISO day-end (23:59:59) string */
    asISODayEnd(): string {
        const d = new Date(this.asDate());
        d.setHours(23, 59, 59, 999);
        return d.toISOString();
    }
}

function validateCalendarDate(token: string): boolean {
    const lower = token.toLowerCase();

    if (["today", "tomorrow", "yesterday"].includes(lower)) {
        return true;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
        return true;
    }

    if (WEEKDAYS.includes(lower)) {
        return true;
    }

    return false;
}

/**
 * CalendarDate entity converter
 * Validates date strings and returns a CalendarDateValue for lazy resolution.
 * Original text is preserved so grammar caching is not invalidated.
 */
export const CalendarDate: EntityConverter<CalendarDateValue> = createConverter(
    validateCalendarDate,
    (token: string): CalendarDateValue | undefined => {
        if (validateCalendarDate(token)) {
            return new CalendarDateValue(token);
        }
        return undefined;
    },
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

/**
 * Rich value returned by the CalendarTime entity converter.
 */
export class CalendarTimeValue {
    readonly hours24: number;
    readonly minutes: number;

    constructor(hours: number, minutes: number) {
        this.hours24 = hours;
        this.minutes = minutes;
    }

    /** Returns canonical "HH:MM" string (backward compatibility) */
    toString(): string {
        return formatTime(this.hours24, this.minutes);
    }

    /**
     * Returns an ISO 8601 string with this time on the given date.
     * Defaults to today if no date is provided.
     */
    asISO(date?: Date): string {
        const d = date ? new Date(date) : new Date();
        d.setHours(this.hours24, this.minutes, 0, 0);
        return d.toISOString();
    }
}

function validateCalendarTime(token: string): boolean {
    return parseTimeToHoursMinutes(token) !== undefined;
}

/**
 * CalendarTime entity converter
 * Validates and converts time strings to CalendarTimeValue
 * "2pm" -> CalendarTimeValue(14, 0), toString() -> "14:00"
 */
export const CalendarTime: EntityConverter<CalendarTimeValue> = createConverter(
    validateCalendarTime,
    (token: string): CalendarTimeValue | undefined => {
        const parsed = parseTimeToHoursMinutes(token);
        if (parsed) {
            return new CalendarTimeValue(parsed.hours, parsed.minutes);
        }
        return undefined;
    },
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

/**
 * Rich value returned by the CalendarTimeRange entity converter.
 */
export class CalendarTimeRangeValue {
    readonly start: CalendarTimeValue;
    readonly end: CalendarTimeValue | undefined;

    constructor(start: CalendarTimeValue, end?: CalendarTimeValue) {
        this.start = start;
        this.end = end;
    }

    /** Returns canonical "HH:MM-HH:MM" or "HH:MM" string (backward compatibility) */
    toString(): string {
        if (this.end) {
            return `${this.start.toString()}-${this.end.toString()}`;
        }
        return this.start.toString();
    }

    /**
     * Returns an object with start (and optionally end) Date values.
     * Defaults to today if no date is provided.
     */
    asRange(date?: Date): { start: Date; end?: Date } {
        const baseDate = date ?? new Date();
        const start = new Date(baseDate);
        start.setHours(this.start.hours24, this.start.minutes, 0, 0);
        if (this.end) {
            const end = new Date(baseDate);
            end.setHours(this.end.hours24, this.end.minutes, 0, 0);
            return { start, end };
        }
        return { start };
    }
}

function validateCalendarTimeRange(token: string): boolean {
    return parseTimeRange(token) !== undefined;
}

/**
 * CalendarTimeRange entity converter
 * Validates and converts time range strings to CalendarTimeRangeValue
 * "10-11pm" -> CalendarTimeRangeValue, toString() -> "22:00-23:00"
 */
export const CalendarTimeRange: EntityConverter<CalendarTimeRangeValue> =
    createConverter(
        validateCalendarTimeRange,
        (token: string): CalendarTimeRangeValue | undefined => {
            const parsed = parseTimeRange(token);
            if (parsed) {
                const start = new CalendarTimeValue(
                    parsed.start.hours,
                    parsed.start.minutes,
                );
                const end = parsed.end
                    ? new CalendarTimeValue(
                          parsed.end.hours,
                          parsed.end.minutes,
                      )
                    : undefined;
                return new CalendarTimeRangeValue(start, end);
            }
            return undefined;
        },
    );

// ============================================================================
// CalendarDayRange Entity
// ============================================================================

/** Day-range expressions that are a fixed number of tokens */
const DAY_RANGE_FIXED = new Set([
    "today",
    "yesterday",
    "this week",
    "past week",
    "last week",
    "this month",
    "past month",
    "last month",
]);

/** Resolve a day-range string to { since?: Date; before?: Date } */
function resolveDayRangeFromText(text: string): {
    since?: Date;
    before?: Date;
} {
    const lower = text.toLowerCase().trim();
    const today = new Date();
    const todayStart = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
    );

    if (lower === "today") {
        return { since: todayStart };
    }
    if (lower === "yesterday") {
        const yStart = new Date(todayStart);
        yStart.setDate(yStart.getDate() - 1);
        return { since: yStart, before: todayStart };
    }
    if (lower === "this week" || lower === "past week") {
        const since = new Date(todayStart);
        since.setDate(since.getDate() - 7);
        return { since };
    }
    if (lower === "last week") {
        const dow = todayStart.getDay();
        const startOfThisWeek = new Date(todayStart);
        startOfThisWeek.setDate(todayStart.getDate() - ((dow + 6) % 7));
        const startOfLastWeek = new Date(startOfThisWeek);
        startOfLastWeek.setDate(startOfThisWeek.getDate() - 7);
        return { since: startOfLastWeek, before: startOfThisWeek };
    }
    if (lower === "this month" || lower === "past month") {
        return {
            since: new Date(todayStart.getFullYear(), todayStart.getMonth(), 1),
        };
    }
    if (lower === "last month") {
        return {
            since: new Date(
                todayStart.getFullYear(),
                todayStart.getMonth() - 1,
                1,
            ),
            before: new Date(
                todayStart.getFullYear(),
                todayStart.getMonth(),
                1,
            ),
        };
    }

    const daysMatch = lower.match(/^(?:last|past)\s+(\d+)\s+days?$/);
    if (daysMatch) {
        const since = new Date(todayStart);
        since.setDate(since.getDate() - parseInt(daysMatch[1], 10));
        return { since };
    }
    const weeksMatch = lower.match(/^(?:last|past)\s+(\d+)\s+weeks?$/);
    if (weeksMatch) {
        const since = new Date(todayStart);
        since.setDate(since.getDate() - parseInt(weeksMatch[1], 10) * 7);
        return { since };
    }
    const monthsMatch = lower.match(/^(?:last|past)\s+(\d+)\s+months?$/);
    if (monthsMatch) {
        const since = new Date(todayStart);
        since.setMonth(since.getMonth() - parseInt(monthsMatch[1], 10));
        return { since };
    }
    const yearMatch = lower.match(/^(\d{4})$/);
    if (yearMatch) {
        const y = parseInt(yearMatch[1], 10);
        return { since: new Date(y, 0, 1), before: new Date(y + 1, 0, 1) };
    }

    return {};
}

/**
 * Rich value returned by the CalendarDayRange entity converter.
 *
 * Represents a natural-language time period like "this week", "last 3 days".
 * The original text is preserved; date arithmetic is lazy.
 */
export class CalendarDayRangeValue {
    readonly text: string;
    private _range: { since?: Date; before?: Date } | undefined;

    constructor(text: string) {
        this.text = text;
    }

    /** Returns the original user text (for backward compatibility) */
    toString(): string {
        return this.text;
    }

    /** Resolves to { since?: Date; before?: Date } (lazy, cached) */
    asDateRange(): { since?: Date; before?: Date } {
        if (!this._range) {
            this._range = resolveDayRangeFromText(this.text);
        }
        return this._range;
    }

    /** Returns { since?: string; before?: string } with ISO 8601 strings */
    asISORange(): { since?: string; before?: string } {
        const r = this.asDateRange();
        const result: { since?: string; before?: string } = {};
        if (r.since) result.since = r.since.toISOString();
        if (r.before) result.before = r.before.toISOString();
        return result;
    }
}

function validateCalendarDayRange(token: string): boolean {
    const lower = token.toLowerCase().trim();

    if (DAY_RANGE_FIXED.has(lower)) {
        return true;
    }

    // "last/past N days/weeks/months"
    if (/^(?:last|past)\s+\d+\s+(?:days?|weeks?|months?)$/.test(lower)) {
        return true;
    }

    // 4-digit year
    if (/^\d{4}$/.test(lower)) {
        return true;
    }

    return false;
}

/**
 * CalendarDayRange entity converter
 * Validates and converts natural-language day-range phrases to CalendarDayRangeValue.
 * Supports multi-token spans: "this week", "last 3 days", "past 2 months", "2024".
 */
export const CalendarDayRange: EntityConverter<CalendarDayRangeValue> =
    createConverter(
        validateCalendarDayRange,
        (token: string): CalendarDayRangeValue | undefined => {
            if (validateCalendarDayRange(token)) {
                return new CalendarDayRangeValue(token);
            }
            return undefined;
        },
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
    globalEntityRegistry.registerConverter(
        "CalendarDayRange",
        CalendarDayRange,
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
    globalEntityRegistry.registerConverter(
        "calendarDayRange",
        CalendarDayRange,
    );
    globalEntityRegistry.registerConverter("percentage", Percentage);
}
