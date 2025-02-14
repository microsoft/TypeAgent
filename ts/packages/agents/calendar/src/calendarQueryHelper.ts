// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventReference } from "./calendarActionsSchemaV1.js";
import {
    getDateRelativeToDayV2,
    getISODayStartTime,
    getISODayEndTime,
    parseFuzzyDateString,
} from "common-utils";

export function generateEventReferenceCriteria(
    eventReference: EventReference,
): string {
    const criteria: string[] = [];

    if (eventReference.day) {
        criteria.push(
            `start/dateTime ge '${eventReference.day}T00:00:00Z' and start/dateTime lt '${eventReference.day}T23:59:59Z'`,
        );
    }
    if (eventReference.dayRange) {
        let nlpCriteria = generateNaturalLanguageCriteria(
            eventReference.dayRange,
        );
        if (nlpCriteria) criteria.push(nlpCriteria);
    }

    if (eventReference.timeRange) {
        criteria.push(
            `start/dateTime ge '${eventReference.timeRange.startTime}' and end/dateTime lt '${eventReference.timeRange.endTime}'`,
        );
    }

    if (eventReference.description) {
        criteria.push(`contains(description,'${eventReference.description}')`);
    }

    if (eventReference.location) {
        criteria.push(
            `contains(location.displayName,'${eventReference.location}')`,
        );
    }

    return criteria.join(" and ");
}

export function getTimeRangeBasedQuery(
    eventReference: EventReference,
): string | undefined {
    if (eventReference.day) {
        return generateQueryFromFuzzyDay(eventReference.day);
    }
    if (eventReference.dayRange) {
        return generateQueryFromFuzzyDay(eventReference.dayRange);
    }

    if (eventReference.timeRange) {
        return `{startDateTime: '${eventReference.timeRange.startTime}', endDateTime: '${eventReference.timeRange.endTime}'}`;
    }
    return undefined;
}

export function getCurrentWeekDates(): { startDate: Date; endDate: Date } {
    const currentDate = new Date();
    const currentDayOfWeek = currentDate.getDay();
    const diff =
        currentDate.getDate() -
        currentDayOfWeek +
        (currentDayOfWeek === 0 ? -6 : 1); // Adjust for Sunday if necessary
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

    const startDateLocal = new Date(
        startYear,
        startMonth,
        startDay,
        0,
        0,
        0,
        0,
    );

    const endDateLocal = new Date(
        startYear,
        startMonth,
        startDay + numDays,
        23,
        59,
        59,
        999,
    );

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
    const currentDate = new Date();
    const startDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        currentDate.getDate(),
    );

    let nDays = nWeeks * 7;
    startDate.setHours(0, 0, 0, 0); // Set to the start of the day (12:00:00 AM)
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + nDays); // Add 13 days to cover a full two weeks
    endDate.setHours(23, 59, 59, 999); // Set to just before midnight (11:59:59 PM)

    const startDateTime = startDate.toISOString();
    const endDateTime = endDate.toISOString();

    return {
        startDateTime,
        endDateTime,
    };
}

export function generateNaturalLanguageCriteria(
    input: string,
): string | undefined {
    switch (input.toLowerCase()) {
        case "this week":
            const { startDate: thisWeekStart, endDate: thisWeekEnd } =
                getCurrentWeekDates();
            return `startdatetime ge '${thisWeekStart.toISOString()}' and enddatetime le '${thisWeekEnd.toISOString()}'`;
        case "this month":
            const { startDate: thisMonthStart, endDate: thisMonthEnd } =
                getCurrentMonthDates();
            return `startdatetime ge '${thisMonthStart.toISOString()}' and enddatetime le '${thisMonthEnd.toISOString()}'`;
        case "today":
            const { startDate: todayStart, endDate: todayEnd } =
                getNextDaysDates(0);
            return `startdatetime ge '${todayStart.toISOString()}' and enddatetime le '${todayEnd.toISOString()}'`;
        case "tomorrow":
            const { startDate: tomorrowStart, endDate: tomorrowEnd } =
                getNextDaysDates(1);
            return `startdatetime ge '${tomorrowStart.toISOString()}' and enddatetime le '${tomorrowEnd.toISOString()}'`;
        default:
            return undefined;
    }
}

export function generateQueryFromFuzzyDay(input: string): string | undefined {
    switch (input.toLowerCase()) {
        case "this week":
            const { startDate: thisWeekStart, endDate: thisWeekEnd } =
                getCurrentWeekDates();
            return `startdatetime=${thisWeekStart.toISOString()}&enddatetime=${thisWeekEnd.toISOString()}`;
        case "next week":
            const { startDateTime: nextWeekStart, endDateTime: nextWeekEnd } =
                getNWeeksDateRangeISO(1);
            return `startdatetime=${nextWeekStart}&enddatetime=${nextWeekEnd}`;
        case "this month":
            const { startDate: thisMonthStart, endDate: thisMonthEnd } =
                getCurrentMonthDates();
            return `startdatetime=${thisMonthStart.toISOString()}&enddatetime=${thisMonthEnd.toISOString()}`;
        case "today":
            const { startDate: todayStart, endDate: todayEnd } =
                getNextDaysDates(0);
            return `startdatetime=${todayStart.toISOString()}&enddatetime=${todayEnd.toISOString()}`;
        case "tomorrow":
            const { startDate: tomorrowStart, endDate: tomorrowEnd } =
                getNextDaysDates(1);
            return `startdatetime=${tomorrowStart.toISOString()}&enddatetime=${tomorrowEnd.toISOString()}`;
        default:
            const curDate =
                getDateRelativeToDayV2(input) ?? parseFuzzyDateString(input);

            if (curDate != undefined) {
                return `startdatetime=${getISODayStartTime(
                    curDate,
                )}&enddatetime=${getISODayEndTime(curDate)}`;
            }
            return undefined;
    }
}
