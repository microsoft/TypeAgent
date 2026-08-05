// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    invalidArgument,
    requireAbsoluteTimestamp,
} from "../../domain/index.js";
import type {
    QueryLanguageOptions,
    TemporalResolution,
    TemporalResolver,
} from "./types.js";

const maximumDayOffset = 366;
const maximumWeekOffset = 52;

export class IntlTemporalResolver implements TemporalResolver {
    public resolve(
        expression: string,
        mode: "during" | "asOf" | "changedDuring",
        options: Pick<QueryLanguageOptions, "timeZone" | "now">,
        changedProjection: "matchingEvents" | "endState" = "matchingEvents",
    ): TemporalResolution {
        validateTimeZone(options.timeZone);
        if (Number.isNaN(options.now.getTime())) {
            return invalidArgument(
                "Temporal resolver requires a valid current time",
            );
        }
        const timezone = {
            timeZone: options.timeZone,
            utcOffsetMinutes: getOffsetMinutes(options.now, options.timeZone),
            resolvedAt: options.now.toISOString(),
        };
        const value = expression.trim();
        if (mode === "asOf") {
            return {
                selector: {
                    type: "asOf",
                    instant: requireAbsoluteTimestamp(value, "asOf"),
                },
                timezone,
            };
        }

        const interval = resolveInterval(value, options);
        return {
            selector:
                mode === "during"
                    ? { type: "during", ...interval }
                    : {
                          type: "changedDuring",
                          ...interval,
                          projection: changedProjection,
                      },
            timezone,
        };
    }
}

export function createResolvedTimezone(
    options: Pick<QueryLanguageOptions, "timeZone" | "now">,
) {
    validateTimeZone(options.timeZone);
    if (Number.isNaN(options.now.getTime())) {
        return invalidArgument(
            "Temporal resolver requires a valid current time",
        );
    }
    return {
        timeZone: options.timeZone,
        utcOffsetMinutes: getOffsetMinutes(options.now, options.timeZone),
        resolvedAt: options.now.toISOString(),
    };
}

function resolveInterval(
    expression: string,
    options: Pick<QueryLanguageOptions, "timeZone" | "now">,
): { start: string; end: string } {
    const absolute = /^\[([^,]+),([^\]]+)\)$/.exec(expression);
    if (absolute !== null) {
        const start = requireAbsoluteTimestamp(absolute[1]!.trim(), "start");
        const end = requireAbsoluteTimestamp(absolute[2]!.trim(), "end");
        if (Date.parse(start) >= Date.parse(end)) {
            return invalidArgument(
                "Temporal interval start must be before end",
            );
        }
        return { start, end };
    }

    const normalized = expression.toLowerCase();
    const currentDate = getLocalDate(options.now, options.timeZone);
    if (normalized === "today") {
        return localDateInterval(currentDate, 1, options.timeZone);
    }
    if (normalized === "yesterday") {
        return localDateInterval(addDays(currentDate, -1), 1, options.timeZone);
    }

    const offset = /^(\d+)\s+(days?|weeks?)\s+ago$/.exec(normalized);
    if (offset !== null) {
        const count = requireOffset(offset[1]!, offset[2]!);
        const isWeek = offset[2]!.startsWith("week");
        const days = isWeek ? count * 7 : count;
        return localDateInterval(
            addDays(currentDate, -days),
            isWeek ? 7 : 1,
            options.timeZone,
        );
    }

    const trailing = /^last\s+(\d+)\s+(days?|weeks?)$/.exec(normalized);
    if (trailing !== null) {
        const count = requireOffset(trailing[1]!, trailing[2]!);
        const days = trailing[2]!.startsWith("week") ? count * 7 : count;
        return {
            start: zonedMidnight(addDays(currentDate, -days), options.timeZone),
            end: zonedMidnight(currentDate, options.timeZone),
        };
    }

    return invalidArgument("Unsupported relative time expression", {
        expression,
    });
}

function requireOffset(value: string, unit: string): number {
    const count = Number(value);
    const maximum = unit.startsWith("week")
        ? maximumWeekOffset
        : maximumDayOffset;
    if (!Number.isSafeInteger(count) || count < 1 || count > maximum) {
        return invalidArgument(`Relative ${unit} offset is out of range`, {
            count,
            maximum,
        });
    }
    return count;
}

type LocalDate = { year: number; month: number; day: number };

function localDateInterval(
    startDate: LocalDate,
    days: number,
    timeZone: string,
): { start: string; end: string } {
    return {
        start: zonedMidnight(startDate, timeZone),
        end: zonedMidnight(addDays(startDate, days), timeZone),
    };
}

function getLocalDate(date: Date, timeZone: string): LocalDate {
    const parts = getParts(date, timeZone);
    return { year: parts.year, month: parts.month, day: parts.day };
}

function addDays(date: LocalDate, days: number): LocalDate {
    const value = new Date(
        Date.UTC(date.year, date.month - 1, date.day + days),
    );
    return {
        year: value.getUTCFullYear(),
        month: value.getUTCMonth() + 1,
        day: value.getUTCDate(),
    };
}

function zonedMidnight(date: LocalDate, timeZone: string): string {
    const localEpoch = Date.UTC(date.year, date.month - 1, date.day);
    let instant = localEpoch;
    for (let iteration = 0; iteration < 4; iteration++) {
        instant =
            localEpoch - getOffsetMinutes(new Date(instant), timeZone) * 60_000;
    }
    return new Date(instant).toISOString();
}

function getOffsetMinutes(date: Date, timeZone: string): number {
    const parts = getParts(date, timeZone);
    const localEpoch = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
    );
    return Math.round((localEpoch - date.getTime()) / 60_000);
}

function getParts(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(
        parts
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, Number(part.value)]),
    );
    return values as {
        year: number;
        month: number;
        day: number;
        hour: number;
        minute: number;
        second: number;
    };
}

function validateTimeZone(timeZone: string): void {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone });
    } catch {
        invalidArgument("timeZone must be an IANA time zone", { timeZone });
    }
}
