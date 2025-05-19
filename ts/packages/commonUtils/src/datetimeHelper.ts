// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    addMilliseconds,
    addMonths,
    format,
    startOfMonth,
    startOfWeek,
    addDays,
    isSameMonth,
    isValid,
    parse,
    parseISO,
} from "date-fns";

export function parseDateString(dateString: string): Date | undefined {
    const parsedDate = parse(dateString, "EEEE MMMM dd, yyyy", new Date());
    if (!parsedDate || isNaN(parsedDate.getTime())) {
        return undefined;
    }
    return parsedDate;
}

export function parseFuzzyDateString(dateString: string): Date | undefined {
    let parsedDate = parseDateString(dateString);
    if (!parsedDate) {
        parsedDate = new Date(Date.parse(dateString));
        // Node Date.parse() returns a fallback year of 2001 if the year is not provided
        if (parsedDate.getFullYear() === 2001) {
            parsedDate.setFullYear(new Date().getFullYear());
        }
    }
    return isValid(parsedDate) ? parsedDate : undefined;
}

export function parseTimeString(timeString: string): string {
    const isPM = timeString.toLowerCase().includes("pm");
    const isAM = timeString.toLowerCase().includes("am");

    if (!isPM && !isAM) {
        timeString += " pm";
    }

    const parsedTime = parse(timeString, "h:mm aa", new Date());

    if (isNaN(parsedTime.getTime())) {
        throw new Error("Invalid time string");
    }

    return format(parsedTime, "HH:mm:ss");
}

export function getShortDate(dateStr: Date): string {
    return format(dateStr, "yyyy-MM-dd");
}

export function combineDateTime(datePart: string, timePart: string): Date {
    const dateTimeString = `${datePart}T${timePart}`;
    const combinedDateTime = parse(
        dateTimeString,
        "yyyy-MM-dd'T'HH:mm:ss",
        new Date(),
    );
    return combinedDateTime;
}

export function getISODayStartTime(currentDate: Date): string {
    const curDay = new Date(currentDate);
    curDay.setHours(0, 0, 0, 0);
    return curDay.toISOString();
}

export function getISODayEndTime(currentDate: Date): string {
    const nextDay = new Date(currentDate);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);
    const lastDateTime = new Date(nextDay.getTime() - 1);
    return lastDateTime.toISOString();
}

export function getTimeZoneName(): string {
    const timeZoneName = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timeZoneName;
}

export function parseDuration(durationString: string): number {
    if (durationString.length > 1000) {
        throw new Error("Invalid duration format");
    }

    const regex =
        /(\d+)\s*(?:hours?|hrs?|h)(?:\s+and\s+(\d+)\s*(?:minutes?|mins?|m))?/i;

    const match = durationString.match(regex);

    if (!match) {
        throw new Error("Invalid duration format");
    }

    const hours = parseInt(match[1], 10) || 0;
    const minutes = parseInt(match[2], 10) || 0;

    const durationMilliseconds = hours * 60 * 60 * 1000 + minutes * 60 * 1000;
    return durationMilliseconds;
}

export function getDateTimeUsingDuration(
    startDateTimeString: string,
    durationString: string,
    fLocaleTime: boolean = true,
): string {
    const startDateTime = parseISO(startDateTimeString);
    const durationMilliseconds = parseDuration(durationString);

    const endDateTime = addMilliseconds(startDateTime, durationMilliseconds);
    return fLocaleTime
        ? endDateTime.toLocaleString()
        : endDateTime.toISOString();
}

export function getDateRelativeToTodayAlt(
    relativeDate: string,
): Date | undefined {
    if (relativeDate.toLowerCase() === "today" || relativeDate === "") {
        return new Date();
    }

    const parsedDate = parseISO(relativeDate);
    if (!isNaN(parsedDate.getTime())) {
        return parsedDate;
    }

    return undefined;
}

export function getDateRelativeToDayV3(relativeDate: string): Date | undefined {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth();

    if (relativeDate.length > 1000) {
        throw new Error("Input too long");
    }
    const relativeDateRegex =
        /^(\d{1,2})?\s*(\w+)?\s*(of)?\s*(this|next)?\s*(\w+)?\s*(month)?$/i;
    const match = relativeDateRegex.exec(relativeDate.trim());

    if (!match) {
        return undefined;
    }

    const [, ordinalStr, dayStr, , direction, monthStr] = match;
    let ordinal = ordinalStr ? parseInt(ordinalStr, 10) : 1;

    let targetMonthIndex: number;
    if (direction && direction.toLowerCase() === "next") {
        targetMonthIndex = currentMonth + 1;
        if (targetMonthIndex > 11) {
            targetMonthIndex = 0; // Move to next year
        }
    } else {
        targetMonthIndex = currentMonth;
    }

    let targetMonth: Date;
    if (monthStr) {
        targetMonth = new Date(Date.parse(monthStr + " 1, " + currentYear));
        if (targetMonth < currentDate) {
            targetMonth = addMonths(targetMonth, 12); // Move to next year
        }
        targetMonthIndex = targetMonth.getMonth();
    } else {
        targetMonth = new Date(currentYear, targetMonthIndex, 1);
    }

    let targetDay: Date;
    if (dayStr) {
        targetDay = startOfWeek(startOfMonth(targetMonth));
        while (targetDay.getDay() !== getDayIndex(dayStr)) {
            targetDay = addDays(targetDay, 1);
        }
        if (ordinal > 1) {
            targetDay = addDays(targetDay, (ordinal - 1) * 7);
            if (!isSameMonth(targetDay, targetMonth)) {
                return undefined; // Out of bounds for the month
            }
        }
    } else {
        return undefined; // Missing day information
    }

    return targetDay;
}

function getDayIndex(dayStr: string): number {
    const daysOfWeek = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
    ];
    const dayIndex = daysOfWeek.indexOf(dayStr.toLowerCase());
    return dayIndex === -1 ? 0 : dayIndex;
}

export function getDateRelativeToDayV2(relativeDate: string): Date | undefined {
    const daysOfWeek = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
    ];
    const daysOfWeekRegex = daysOfWeek.join("|");

    const relativeDateRegex = new RegExp(
        `^(?:(this|next)\\s+)?(${daysOfWeekRegex})$`,
        "i",
    );
    const match = relativeDateRegex.exec(relativeDate.trim());

    if (!match) {
        return undefined; // Invalid input format
    }

    const [, relativePrefix, dayStr] = match;

    let targetDayIndex = daysOfWeek.indexOf(dayStr.toLowerCase());
    if (targetDayIndex === -1) {
        return undefined; // Invalid day name
    }

    const currentDate = new Date();
    const currentDayIndex = currentDate.getDay();

    if (relativePrefix && relativePrefix.toLowerCase() === "next") {
        targetDayIndex += 7; // Move to the next week
    }

    let targetDayOffset = targetDayIndex - currentDayIndex;
    if (targetDayOffset <= 0) {
        targetDayOffset += 7;
    }

    const targetDate = new Date(currentDate);
    targetDate.setDate(currentDate.getDate() + targetDayOffset);

    return targetDate;
}

export function getDateRelativeToDayV1(relativeDate: string): Date | undefined {
    const daysOfWeek = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
    ];
    const targetDay = daysOfWeek.indexOf(relativeDate.toLowerCase());

    if (targetDay === -1) {
        return undefined;
    }

    const currentDate = new Date();
    const currentDay = currentDate.getDay();

    let dayOffset = targetDay - currentDay;
    if (dayOffset <= 0) {
        dayOffset += 7;
    }

    const targetDate = new Date(currentDate);
    targetDate.setDate(currentDate.getDate() + dayOffset);

    return targetDate;
}

export function getDateRelativeToToday(relativeDate: string): Date | undefined {
    if (relativeDate.toLowerCase() === "today" || relativeDate === "") {
        return new Date();
    }

    let parsedDate: Date | undefined = getDateRelativeToDayV2(relativeDate);
    if (parsedDate && isValid(parsedDate)) {
        return parsedDate;
    }

    parsedDate = getDateFromNLP(relativeDate);
    if (parsedDate && isValid(parsedDate)) {
        return parsedDate;
    }

    const formatStrings = [
        "PPPP", // Locale-specific date format like "Friday, March 15, 2024"
        "MMMM dd", // Date format without the year like "March 15"
        "do MMMM", // Date format with ordinal like "15th March"
        "dd MMMM", // Date format with day and month reversed like "15 March"
        "MMMM do", // Date format with ordinal and month first like "March 15th"
        "EEEE MMMM dd, yyyy", // Date format with full weekday like "Friday March 15, 2024"
        "MMMM dd, yyyy", // Date format with full weekday like "March 15, 2024"
    ];

    for (const formatString of formatStrings) {
        parsedDate = parse(relativeDate, formatString, new Date());
        if (!isNaN(parsedDate.getTime())) {
            // Check if the parsed date is in the past
            const currentDate = new Date();
            if (parsedDate < currentDate) {
                // Adjust the year to the current year
                parsedDate.setFullYear(currentDate.getFullYear());
            }
            return parsedDate;
        }
    }

    if (parsedDate && isValid(parsedDate)) {
        return parsedDate;
    }

    return undefined;
}

export function formatTime(time: string): string {
    if (isValidTime(time)) {
        return time;
    }

    const parts = time.match(/^(\d+)(?::(\d+))?\s*(AM|PM)?$/i);
    if (!parts) {
        throw new Error("Invalid time format");
    }

    const hourStr = parts[1];
    const minuteStr = parts[2] || "00";
    const period = parts[3] ? parts[3].toUpperCase() : "";

    const hour = parseInt(hourStr, 10) % 12 || 12;
    const formattedHour = hour.toString().padStart(2, "0");

    const determinedPeriod =
        period || (parseInt(hourStr, 10) == 12 ? "PM" : "AM");
    return `${formattedHour}:${minuteStr} ${determinedPeriod}`;
}

export function isValidTime(time: string): boolean {
    // Regular expression to match time in HH:MM AM/PM format
    const timeRegex = /^(0?[1-9]|1[0-2]):[0-5][0-9]\s+(AM|PM)$/i;
    return timeRegex.test(time);
}

function getDateFromNLP(relativeDate: string): Date | undefined {
    let date: Date;
    switch (relativeDate.toLowerCase()) {
        case "today":
            date = new Date();
            break;
        case "tomorrow":
            date = addDays(new Date(), 1);
            break;
        default:
            const match = relativeDate.match(/^(\d+)\s*days?\s*(?:later)?$/i);
            if (match && match[1]) {
                const daysToAdd = parseInt(match[1], 10);
                date = addDays(new Date(), daysToAdd);
            } else {
                return undefined;
            }
    }

    return date;
}

export async function getNormalizedDateRange(
    inputDate: string,
    startTime: string | undefined,
    endTime: string | undefined,
    duration: string | undefined,
    fLocaleTime: boolean = true,
): Promise<
    | {
          startDate: string;
          endDate: string;
      }
    | undefined
> {
    let currentDate = getShortDate(new Date(inputDate));
    if (currentDate !== undefined) {
        if (startTime != undefined) {
            let startDateTime = combineDateTime(
                currentDate,
                parseTimeString(formatTime(startTime)),
            );
            startTime = fLocaleTime
                ? startDateTime.toLocaleString()
                : startDateTime.toISOString();

            if (endTime === undefined) {
                endTime = getDateTimeUsingDuration(
                    startDateTime.toISOString(),
                    duration != undefined ? duration : "1 hour",
                    fLocaleTime,
                );
            } else {
                let endDateTime = combineDateTime(
                    currentDate,
                    parseTimeString(formatTime(endTime)),
                );
                endTime = fLocaleTime
                    ? endDateTime.toLocaleString()
                    : endDateTime.toISOString();
            }
            return { startDate: startTime, endDate: endTime };
        }
    }
    return undefined;
}

export async function getNormalizedDateTimes(
    day: string | undefined,
    startTime: string | undefined,
    endTime: string | undefined,
    duration: string | undefined,
    fLocaleTime: boolean = true,
): Promise<{ startDate: string; endDate: string } | undefined> {
    let curDay: Date | undefined;
    if (day === "" || day === undefined) {
        curDay = new Date();
    } else {
        curDay = getDateRelativeToToday(day);
    }

    if (curDay === undefined) return undefined;

    let currentDate = getShortDate(curDay);
    if (startTime != undefined) {
        let startDateTime = combineDateTime(
            currentDate,
            parseTimeString(formatTime(startTime)),
        );
        startTime = fLocaleTime
            ? startDateTime.toLocaleString()
            : startDateTime.toISOString();

        if (endTime === undefined) {
            endTime = getDateTimeUsingDuration(
                startDateTime.toISOString(),
                duration != undefined ? duration : "1 hour",
                fLocaleTime,
            );
        } else {
            let endDateTime = combineDateTime(
                currentDate,
                parseTimeString(formatTime(endTime)),
            );
            endTime = fLocaleTime
                ? endDateTime.toLocaleString()
                : endDateTime.toISOString();
        }
        return { startDate: startTime, endDate: endTime };
    }
    return undefined;
}

export function getUniqueLocalId(timestamp?: Date): string {
    timestamp ??= new Date();
    let localid = timestamp.toISOString();
    localid = localid.replace(/[-:.TZ]/g, "");
    return localid;
}
