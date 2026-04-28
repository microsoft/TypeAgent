// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    validateCalendarDate,
    validateCalendarTime,
} from "../src/calendarActionHandlerV3.js";

describe("validateCalendarDate", () => {
    test("rejects empty string", () => {
        expect(validateCalendarDate("")).toBe(false);
        expect(validateCalendarDate("   ")).toBe(false);
    });

    test("accepts today/tomorrow/yesterday", () => {
        expect(validateCalendarDate("today")).toBe(true);
        expect(validateCalendarDate("Tomorrow")).toBe(true);
        expect(validateCalendarDate("YESTERDAY")).toBe(true);
    });

    test("accepts relative terms (next/last/this)", () => {
        expect(validateCalendarDate("next Monday")).toBe(true);
        expect(validateCalendarDate("last Friday")).toBe(true);
        expect(validateCalendarDate("this week")).toBe(true);
    });

    test("accepts parseable date strings", () => {
        expect(validateCalendarDate("March 15, 2025")).toBe(true);
        expect(validateCalendarDate("2025-03-15")).toBe(true);
    });

    test("rejects nonsense strings", () => {
        expect(validateCalendarDate("xyzzy")).toBe(false);
        expect(validateCalendarDate("notadate")).toBe(false);
    });
});

describe("validateCalendarTime", () => {
    test("rejects empty string", () => {
        expect(validateCalendarTime("")).toBe(false);
        expect(validateCalendarTime("   ")).toBe(false);
    });

    test("accepts named times", () => {
        expect(validateCalendarTime("noon")).toBe(true);
        expect(validateCalendarTime("midnight")).toBe(true);
        expect(validateCalendarTime("morning")).toBe(true);
        expect(validateCalendarTime("evening")).toBe(true);
        expect(validateCalendarTime("afternoon")).toBe(true);
        expect(validateCalendarTime("night")).toBe(true);
    });

    test("accepts HH:MM 24-hour format", () => {
        expect(validateCalendarTime("9:00")).toBe(true);
        expect(validateCalendarTime("14:30")).toBe(true);
        expect(validateCalendarTime("23:59")).toBe(true);
        expect(validateCalendarTime("0:00")).toBe(true);
    });

    test("rejects invalid HH:MM values", () => {
        expect(validateCalendarTime("25:00")).toBe(false);
        expect(validateCalendarTime("12:60")).toBe(false);
    });

    test("accepts 12-hour format strings", () => {
        expect(validateCalendarTime("3pm")).toBe(true);
        expect(validateCalendarTime("10am")).toBe(true);
        expect(validateCalendarTime("3:30pm")).toBe(true);
    });

    test("rejects nonsense strings", () => {
        expect(validateCalendarTime("xyzzy")).toBe(false);
        expect(validateCalendarTime("notatime")).toBe(false);
    });
});
