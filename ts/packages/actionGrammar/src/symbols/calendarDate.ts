// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SymbolConverter, createConverter } from "../symbolModule.js";

/**
 * CalendarDate symbol converter
 * Converts date-like strings (today, tomorrow, yesterday, ISO dates) to Date objects
 */

function matchCalendarDate(token: string): boolean {
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
 * CalendarDate symbol converter
 * Converts date strings to Date objects
 */
export const CalendarDate: SymbolConverter<Date> = createConverter(
    matchCalendarDate,
    convertCalendarDate,
);

/**
 * Type-safe helper for converting calendar dates in agent code
 * @param token The date string to convert
 * @returns A Date object, or undefined if not a valid date
 *
 * @example
 * const date = convertCalendarDateValue("today"); // Date for today
 * const date2 = convertCalendarDateValue("2026-01-23"); // Date for Jan 23, 2026
 * const date3 = convertCalendarDateValue("tomorrow"); // Date for tomorrow
 */
export function convertCalendarDateValue(token: string): Date | undefined {
    return CalendarDate.convert(token);
}
