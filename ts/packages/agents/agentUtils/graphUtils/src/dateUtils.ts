// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// ── Date range primitives ─────────────────────────────────────────────────────
// Shared by calendar and email agents for natural-language date resolution.

export function getCurrentWeekDates(): { startDate: Date; endDate: Date } {
    const currentDate = new Date();
    const currentDayOfWeek = currentDate.getDay();
    const diff =
        currentDate.getDate() -
        currentDayOfWeek +
        (currentDayOfWeek === 0 ? -6 : 1); // Adjust for Sunday
    const weekStart = new Date(currentDate.setDate(diff));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return { startDate: weekStart, endDate: weekEnd };
}

export function getCurrentMonthDates(): { startDate: Date; endDate: Date } {
    const currentDate = new Date();
    const monthStart = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1,
    );
    const monthEnd = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        0,
    );
    return { startDate: monthStart, endDate: monthEnd };
}

export function getNextDaysDates(numDays: number): {
    startDate: Date;
    endDate: Date;
} {
    const currentDate = new Date();
    const startYear = currentDate.getFullYear();
    const startMonth = currentDate.getMonth();
    const startDay = currentDate.getDate();

    const startDateLocal = new Date(startYear, startMonth, startDay, 0, 0, 0, 0);
    const endDateLocal = new Date(
        startYear,
        startMonth,
        startDay + numDays,
        23,
        59,
        59,
        999,
    );

    // Adjust for timezone offset so the query uses local midnight, not UTC midnight
    const startDateUTC = new Date(
        startDateLocal.getTime() - startDateLocal.getTimezoneOffset() * 60000,
    );
    const endDateUTC = new Date(
        endDateLocal.getTime() - endDateLocal.getTimezoneOffset() * 60000,
    );
    return { startDate: startDateUTC, endDate: endDateUTC };
}

export function getNWeeksDateRangeISO(nWeeks: number): {
    startDateTime: string;
    endDateTime: string;
} {
    const today = new Date();
    const startDate = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
        0,
        0,
        0,
        0,
    );
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + nWeeks * 7);
    endDate.setHours(23, 59, 59, 999);
    return { startDateTime: startDate.toISOString(), endDateTime: endDate.toISOString() };
}

// ── parseDayRange ─────────────────────────────────────────────────────────────
// Convert a natural-language day range string into ISO date bounds.
// Used by email (EmailSearchQuery.startDateTime/endDateTime) and any other
// agent that needs ISO strings rather than OData query fragments.

export function parseDayRange(dayRange: string): {
    since?: string;
    before?: string;
} {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const iso = (d: Date) => d.toISOString();
    const lower = dayRange.toLowerCase().trim();

    if (lower === "today") {
        return { since: iso(getNextDaysDates(0).startDate) };
    }

    if (lower === "yesterday") {
        const { startDate } = getNextDaysDates(0);
        const yStart = new Date(startDate);
        yStart.setDate(yStart.getDate() - 1);
        return { since: iso(yStart), before: iso(startDate) };
    }

    if (lower === "this week" || lower === "past week") {
        const since = new Date(todayStart);
        since.setDate(since.getDate() - 7);
        return { since: iso(since) };
    }

    if (lower === "last week") {
        const dow = todayStart.getDay();
        const startOfThisWeek = new Date(todayStart);
        startOfThisWeek.setDate(todayStart.getDate() - ((dow + 6) % 7));
        const startOfLastWeek = new Date(startOfThisWeek);
        startOfLastWeek.setDate(startOfThisWeek.getDate() - 7);
        return { since: iso(startOfLastWeek), before: iso(startOfThisWeek) };
    }

    if (lower === "this month" || lower === "past month") {
        return { since: iso(getCurrentMonthDates().startDate) };
    }

    if (lower === "last month") {
        return {
            since: iso(new Date(todayStart.getFullYear(), todayStart.getMonth() - 1, 1)),
            before: iso(new Date(todayStart.getFullYear(), todayStart.getMonth(), 1)),
        };
    }

    const daysMatch = lower.match(/(?:last|past)\s+(\d+)\s+days?/);
    if (daysMatch) {
        const since = new Date(todayStart);
        since.setDate(since.getDate() - parseInt(daysMatch[1], 10));
        return { since: iso(since) };
    }

    const weeksMatch = lower.match(/(?:last|past)\s+(\d+)\s+weeks?/);
    if (weeksMatch) {
        const since = new Date(todayStart);
        since.setDate(since.getDate() - parseInt(weeksMatch[1], 10) * 7);
        return { since: iso(since) };
    }

    const monthsMatch = lower.match(/(?:last|past)\s+(\d+)\s+months?/);
    if (monthsMatch) {
        const since = new Date(todayStart);
        since.setMonth(since.getMonth() - parseInt(monthsMatch[1], 10));
        return { since: iso(since) };
    }

    const yearMatch = lower.match(/^(\d{4})$/);
    if (yearMatch) {
        const y = parseInt(yearMatch[1], 10);
        return { since: iso(new Date(y, 0, 1)), before: iso(new Date(y + 1, 0, 1)) };
    }

    return {};
}
