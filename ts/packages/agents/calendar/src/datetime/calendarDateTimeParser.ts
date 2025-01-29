import { CalendarDateTime } from "../calendarActionsSchemaV2.js";

export function parseCalendarDateTime(calDateTime: CalendarDateTime): string {
    let date = new Date();

    // Handle Year
    if (calDateTime.year) {
        let year;
        if (
            calDateTime.year.startsWith("+") ||
            calDateTime.year.startsWith("-")
        ) {
            const yearOffset = parseOffset(calDateTime.year.replace("y", ""));
            year = date.getUTCFullYear() + yearOffset;
        } else {
            year = parseInt(calDateTime.year, 10);
        }

        if (!isNaN(year)) {
            date.setUTCFullYear(year);
        } else {
            throw new Error("Invalid input: Year could not be parsed.");
        }
    }

    // Handle Week
    if (calDateTime.week) {
        const weekOffset = parseOffset(calDateTime.week.replace("w", ""));
        const daysToAdd = weekOffset * 7; // 1 week = 7 days
        date.setUTCDate(date.getUTCDate() + daysToAdd);
    }

    // Handle Month (Updated)
    if (calDateTime.month) {
        const currentMonth = date.getUTCMonth();

        if (
            calDateTime.month.startsWith("+") ||
            calDateTime.month.startsWith("-")
        ) {
            const monthOffset = parseOffset(calDateTime.month.replace("M", ""));
            const newMonth = currentMonth + monthOffset;

            const yearAdjustment = Math.floor(newMonth / 12);
            const adjustedMonth = ((newMonth % 12) + 12) % 12; // Ensure valid month index

            // Temporarily set to the first day of the month to prevent day overflow
            date.setUTCDate(1);
            date.setUTCFullYear(date.getUTCFullYear() + yearAdjustment);
            date.setUTCMonth(adjustedMonth);
        } else if (isNaN(parseInt(calDateTime.month, 10))) {
            const monthIndex = monthToIndex(calDateTime.month);
            if (monthIndex !== -1) {
                date.setUTCMonth(monthIndex);
            } else {
                throw new Error(
                    "Invalid input: Month name could not be parsed.",
                );
            }
        } else {
            const monthIndex = parseInt(calDateTime.month, 10) - 1;
            date.setUTCMonth(monthIndex);
        }
    }

    // Handle Day
    if (calDateTime.day) {
        if (
            calDateTime.day.startsWith("+") ||
            calDateTime.day.startsWith("-")
        ) {
            // Calculate relative days
            const dayOffset = parseOffset(calDateTime.day.replace("d", ""));
            date.setUTCDate(date.getUTCDate() + dayOffset);
        } else if (!isNaN(parseInt(calDateTime.day, 10))) {
            // Absolute day
            date.setUTCDate(parseInt(calDateTime.day, 10));
        } else {
            // Handle named days like "Monday"
            const weekdays = [
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
            ];
            const targetDayIndex = weekdays.indexOf(calDateTime.day);
            if (targetDayIndex === -1) {
                throw new Error("Invalid input: Day name could not be parsed.");
            }
            const currentDayIndex = date.getUTCDay();
            const daysUntilTarget = (targetDayIndex - currentDayIndex + 7) % 7;
            date.setUTCDate(date.getUTCDate() + daysUntilTarget);
        }
    }

    // Handle HMS
    if (calDateTime.hms) {
        switch (calDateTime.hms.toLowerCase()) {
            case "noon":
                date.setUTCHours(12, 0, 0, 0);
                break;
            case "midnight":
                date.setUTCHours(0, 0, 0, 0);
                break;
            default:
                const [hours, minutes, seconds] = calDateTime.hms
                    .split(":")
                    .map(Number);
                date.setUTCHours(hours || 0, minutes || 0, seconds || 0, 0);
                break;
        }
    }

    return date.toISOString();
}

function monthToIndex(month: string): number {
    const months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    return months.findIndex((m) => m.toLowerCase() === month.toLowerCase());
}

// Parse offsets like "+1y", "-1M", "+3d", etc.
function parseOffset(value: string): number {
    if (value.startsWith("+")) {
        return parseInt(value.slice(1));
    } else if (value.startsWith("-")) {
        return -parseInt(value.slice(1));
    } else {
        return parseInt(value);
    }
}
export interface DateTimeParseResult {
    success: boolean;
    parsedDateTime?: string;
    errors?: string[];
}

export function calcEndDateTime(
    startDateTime: string,
    duration: string,
): DateTimeParseResult {
    const errors: string[] = [];
    const result: DateTimeParseResult = { success: false, errors };

    const start = new Date(startDateTime);
    if (isNaN(start.getTime())) {
        errors.push("Invalid start datetime format.");
        return result;
    }

    const durationRegex =
        /(?<days>\d+d)?(?<hours>\d+h)?(?<minutes>\d+m)?(?<seconds>\d+s)?/;
    const match = duration.match(durationRegex);
    if (!match || !match.groups) {
        errors.push("Invalid duration format.");
        return result;
    }

    const days = parseInt(match.groups.days || "0", 10);
    const hours = parseInt(match.groups.hours || "0", 10);
    const minutes = parseInt(match.groups.minutes || "0", 10);
    const seconds = parseInt(match.groups.seconds || "0", 10);

    start.setUTCDate(start.getUTCDate() + days);
    start.setUTCHours(start.getUTCHours() + hours);
    start.setUTCMinutes(start.getUTCMinutes() + minutes);
    start.setUTCSeconds(start.getUTCSeconds() + seconds);

    return {
        success: true,
        parsedDateTime: start.toISOString(),
    };
}

export function getQueryParamsFromTimeRange(calStartDateTime: CalendarDateTime, calEndDateTime: CalendarDateTime): string | undefined {
    const startDateTime = parseCalendarDateTime(calStartDateTime);
    const endDateTime = parseCalendarDateTime(calEndDateTime);

    if (!startDateTime || !endDateTime) {
        return undefined; // Return undefined if either date couldn't be parsed
    }

    return `startDateTime=${encodeURIComponent(
        startDateTime
    )}&endDateTime=${encodeURIComponent(endDateTime)}`;
}

