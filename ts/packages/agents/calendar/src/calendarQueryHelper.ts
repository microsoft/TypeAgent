// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventReference } from "./calendarActionsSchemaV1.js";
import {
    getDateRelativeToDayV2,
    getISODayStartTime,
    getISODayEndTime,
    parseFuzzyDateString,
} from "typechat-utils";
import {
    getCurrentWeekDates,
    getCurrentMonthDates,
    getNextDaysDates,
    getNWeeksDateRangeISO,
} from "graph-utils";

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

export { getCurrentWeekDates, getCurrentMonthDates, getNextDaysDates, getNWeeksDateRangeISO };

export function generateNaturalLanguageCriteria(
    input: string,
): string | undefined {
    // Normalize: grammar matching may deliver a rich value object (e.g. CalendarDayRangeValue)
    // whose toString() returns the original text. String() is a no-op for plain strings.
    const text = String(input).toLowerCase();
    switch (text) {
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
    // Normalize: grammar matching may deliver a rich value object (e.g. CalendarDateValue,
    // CalendarDayRangeValue) whose toString() returns the original text.
    const text = String(input);
    switch (text.toLowerCase()) {
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
                getDateRelativeToDayV2(text) ?? parseFuzzyDateString(text);

            if (curDate != undefined) {
                return `startdatetime=${getISODayStartTime(
                    curDate,
                )}&enddatetime=${getISODayEndTime(curDate)}`;
            }
            return undefined;
    }
}
