
import { CalendarDateTime } from "./calendarDateTime.js";
//import { add } from 'date-fns';


function isStartOrEndDay(day: string): boolean {
    return (
        day === "StartOfWeek" ||
        day === "EndOfWeek" ||
        day === "StartOfMonth" ||
        day === "EndOfMonth" ||
        day === "StartOfDay" ||
        day === "EndOfDay" ||
        day === "StartOfYear" ||
        day === "EndOfYear"
    );
}

function isNumberString(str: string): boolean {
    return /^\d+$/.test(str);
}

export function convertCalDateTime(
    calDateTime: CalendarDateTime,
    isStart = true,
): string {
    switch (calDateTime?.specialDateTime) {
        case "Now":
            return "now";
        case "InThePast":
            return "error: past";
        case "InTheFuture":
            if (
                calDateTime.month === undefined &&
                calDateTime.week === undefined &&
                calDateTime.hms === undefined &&
                calDateTime.year === undefined &&
                (calDateTime.day === undefined ||
                    calDateTime.day === "0" ||
                    calDateTime.day?.toLocaleLowerCase() === "today")
            ) {
                return "now.endofday";
            } else {
                return "error: future";
            }
    }
    let accum = "now";
    if (
        calDateTime.year !== undefined &&
        calDateTime.year !== "0" &&
        (isNumberString(calDateTime.year) ||
            isStartOrEndDay(calDateTime.year) ||
            calDateTime.year.startsWith("+") ||
            calDateTime.year.startsWith("-"))
    ) {
        accum += ".";
        accum += calDateTime.year.toLocaleLowerCase();
    }
    if (calDateTime.year === "0") {
        if (isStart) {
            accum += ".startofyear";
        } else {
            accum += ".endofyear";
        }
    }

    if (calDateTime.month !== undefined) {
        accum += ".";
        accum += calDateTime.month;
        if (calDateTime.day !== undefined) {
            if (
                calDateTime.day === "StartOfMonth" ||
                calDateTime.day === "EndOfMonth"
            ) {
                accum += ".";
                accum += calDateTime.day.toLocaleLowerCase();
            } else {
                accum += " ";
                accum += calDateTime.day;

                if (calDateTime.hms === undefined) {
                    if (isStart) {
                        accum += ".startofday";
                    } else {
                        accum += ".endofday";
                    }
                }
            }
        } else {
            if (isStart) {
                accum += ".startofmonth";
            } else {
                accum += ".endofmonth";
            }
        }
    } else if (calDateTime.week !== undefined) {
        if (calDateTime.week === "0") {
            if (isStart) {
                accum += ".startofweek";
            } else {
                accum += ".endofweek";
            }
        } else {
            accum += ".";
            accum += calDateTime.week;
            if (calDateTime.day !== undefined) {
                accum += ".";
                if (
                    calDateTime.day === "StartOfWeek" ||
                    calDateTime.day === "EndOfWeek"
                ) {
                    accum += calDateTime.day.toLocaleLowerCase();
                } else {
                    accum += calDateTime.day;
                }
            } else {
                if (isStart) {
                    accum += ".startofweek";
                } else {
                    accum += ".endofweek";
                }
            }
        }
    } else if (
        calDateTime.day !== undefined &&
        calDateTime.day !== "0" &&
        calDateTime.day !== "Now" &&
        calDateTime.day.toLocaleLowerCase() !== "today"
    ) {
        accum += ".";
        if (
            calDateTime.day === "StartOfWeek" ||
            calDateTime.day === "EndOfWeek"
        ) {
            accum += calDateTime.day.toLocaleLowerCase();
        } else {
            accum += calDateTime.day;
        }
    } else if (
        (calDateTime.day === "0" ||
            calDateTime.day?.toLocaleLowerCase() === "today") &&
        calDateTime.hms === undefined
    ) {
        if (isStart) {
            accum += ".startofday";
        } else {
            accum += ".endofday";
        }
    }
    if (calDateTime.hms !== undefined && calDateTime.hms !== "Now") {
        accum += ".";
        switch (calDateTime.hms) {
            case "Noon":
            case "12:00:00":
                if (isStart) {
                    accum += "12:00:00";
                } else {
                    accum += "11:59:59";
                }
                break;
            case "Midnight":
            case "00:00:00":
            case "08:00:00":
                if (isStart) {
                    accum += "startofday";
                } else {
                    accum += "23:59:59";
                }
                break;
            default:
                accum += calDateTime.hms;
                break;
        }
    } else if (
        calDateTime.day !== undefined &&
        !isStartOrEndDay(calDateTime.day) &&
        calDateTime.day !== "0" &&
        calDateTime.day !== "Now" &&
        calDateTime.day.toLocaleLowerCase() !== "today" &&
        calDateTime.month === undefined
    ) {
        if (isStart) {
            accum += ".startofday";
        } else {
            accum += ".endofday";
        }
    }
    return accum;
}

export function getState(start?: CalendarDateTime, end?: CalendarDateTime) {
    if (
        start &&
        start.specialDateTime === "Now" &&
        (end === undefined ||
            end.specialDateTime === "InTheFuture" ||
            end.specialDateTime === "Now")
    ) {
        return "upcoming";
    } else if (
        start &&
        start.specialDateTime === "InTheFuture" &&
        end === undefined
    ) {
        return "upcoming";
    } else if (
        start &&
        start.specialDateTime === "InThePast" &&
        (end === undefined ||
            end.specialDateTime === "Now" ||
            end.specialDateTime === "InThePast")
    ) {
        return "completed";
    } else if (start == undefined && end && end.specialDateTime === "Now") {
        return "completed";
    } else {
        return undefined;
    }
}

export function parseCalendarDateTime(calDateTime: CalendarDateTime): string {
    // Start with the current date
    let date = new Date();

    if (calDateTime.year) {
        const year = parseInt(calDateTime.year, 10);
        if (!isNaN(year)) {
            date.setUTCFullYear(year);
        }
    }

    if (calDateTime.month) {
        const monthIndex =
            isNaN(parseInt(calDateTime.month, 10))
                ? parseOffset(calDateTime.month) + date.getUTCMonth()
                : monthToIndex(calDateTime.month);

        if (monthIndex >= 0 && monthIndex <= 11) {
            date.setUTCMonth(monthIndex);
        }
    }

    if (calDateTime.day) {
        const day =
            !isNaN(parseInt(calDateTime.day, 10))
                ? parseInt(calDateTime.day, 10)
                : parseOffset(calDateTime.day) + date.getUTCDate();

        date.setUTCDate(day);
    }

    if (calDateTime.hms) {
        switch (calDateTime.hms) {
            case "Noon":
                date.setUTCHours(12, 0, 0, 0);
                break;
            case "Midnight":
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

// Helper Function to Convert Month Name to Index
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
    return months.indexOf(month);
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


