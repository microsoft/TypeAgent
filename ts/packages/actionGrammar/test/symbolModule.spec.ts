// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Grammar } from "../src/grammarTypes.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchNFA } from "../src/nfaInterpreter.js";
import { registerBuiltInSymbols } from "../src/symbols/index.js";
import { globalSymbolRegistry } from "../src/symbolModule.js";
import { convertOrdinalValue } from "../src/symbols/ordinal.js";
import { convertCardinalValue } from "../src/symbols/cardinal.js";
import { convertCalendarDateValue } from "../src/symbols/calendarDate.js";

describe("Symbol Module System", () => {
    beforeAll(() => {
        // Register built-in symbols once for all tests
        registerBuiltInSymbols();
    });

    describe("Symbol Registry", () => {
        it("should have registered Global.Ordinal", () => {
            expect(globalSymbolRegistry.hasSymbol("Global.Ordinal")).toBe(true);
            expect(globalSymbolRegistry.hasSymbol("Ordinal")).toBe(true);
        });

        it("should have registered Global.Cardinal", () => {
            expect(globalSymbolRegistry.hasSymbol("Global.Cardinal")).toBe(
                true,
            );
            expect(globalSymbolRegistry.hasSymbol("Cardinal")).toBe(true);
        });

        it("should have registered Calendar.CalendarDate", () => {
            expect(
                globalSymbolRegistry.hasSymbol("Calendar.CalendarDate"),
            ).toBe(true);
            expect(globalSymbolRegistry.hasSymbol("CalendarDate")).toBe(true);
        });
    });

    describe("Ordinal Symbol", () => {
        it("should match and convert ordinals", () => {
            const matcher = globalSymbolRegistry.getMatcher("Ordinal");
            expect(matcher).toBeDefined();
            expect(matcher!.match("first")).toBe(true);
            expect(matcher!.match("third")).toBe(true);
            expect(matcher!.match("invalid")).toBe(false);

            const converter =
                globalSymbolRegistry.getConverter<number>("Ordinal");
            expect(converter).toBeDefined();
            expect(converter!.convert("first")).toBe(1);
            expect(converter!.convert("third")).toBe(3);
            expect(converter!.convert("twenty-third")).toBe(23);
        });

        it("should work with helper function", () => {
            expect(convertOrdinalValue("first")).toBe(1);
            expect(convertOrdinalValue("tenth")).toBe(10);
            expect(convertOrdinalValue("twenty-fifth")).toBe(25);
            expect(convertOrdinalValue("invalid")).toBeUndefined();
        });
    });

    describe("Cardinal Symbol", () => {
        it("should match and convert cardinals", () => {
            const converter =
                globalSymbolRegistry.getConverter<number>("Cardinal");
            expect(converter).toBeDefined();
            expect(converter!.convert("five")).toBe(5);
            expect(converter!.convert("42")).toBe(42);
            expect(converter!.convert("twenty")).toBe(20);
        });

        it("should work with helper function", () => {
            expect(convertCardinalValue("one")).toBe(1);
            expect(convertCardinalValue("15")).toBe(15);
            expect(convertCardinalValue("thirty")).toBe(30);
        });
    });

    describe("CalendarDate Symbol", () => {
        it("should match date strings", () => {
            const matcher = globalSymbolRegistry.getMatcher("CalendarDate");
            expect(matcher).toBeDefined();
            expect(matcher!.match("today")).toBe(true);
            expect(matcher!.match("tomorrow")).toBe(true);
            expect(matcher!.match("monday")).toBe(true);
            expect(matcher!.match("2026-01-23")).toBe(true);
            expect(matcher!.match("invalid")).toBe(false);
        });

        it("should convert date strings to Date objects", () => {
            const today = convertCalendarDateValue("today");
            expect(today).toBeInstanceOf(Date);

            const isoDate = convertCalendarDateValue("2026-01-23");
            expect(isoDate).toBeInstanceOf(Date);
            expect(isoDate!.getFullYear()).toBe(2026);
            expect(isoDate!.getMonth()).toBe(0); // January
            expect(isoDate!.getDate()).toBe(23);
        });
    });

    describe("NFA Integration with Symbols", () => {
        it("should compile and match grammar with Ordinal symbol", () => {
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            { type: "string", value: ["the"] },
                            {
                                type: "wildcard",
                                variable: "n",
                                typeName: "Ordinal",
                            },
                            { type: "string", value: ["track"] },
                        ],
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar, "ordinal-test");
            const result = matchNFA(nfa, ["play", "the", "first", "track"]);

            expect(result.matched).toBe(true);
            expect(result.captures.get("n")).toBe(1);
        });

        it("should fail to match invalid ordinal", () => {
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            {
                                type: "wildcard",
                                variable: "n",
                                typeName: "Ordinal",
                            },
                        ],
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar);
            const result = matchNFA(nfa, ["play", "invalid"]);

            expect(result.matched).toBe(false);
        });

        it("should compile and match grammar with Cardinal symbol", () => {
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["track"] },
                            {
                                type: "wildcard",
                                variable: "n",
                                typeName: "Cardinal",
                            },
                        ],
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar, "cardinal-test");

            // Test with word number
            const result1 = matchNFA(nfa, ["track", "five"]);
            expect(result1.matched).toBe(true);
            expect(result1.captures.get("n")).toBe(5);

            // Test with numeric string
            const result2 = matchNFA(nfa, ["track", "42"]);
            expect(result2.matched).toBe(true);
            expect(result2.captures.get("n")).toBe(42);
        });

        it("should compile and match grammar with CalendarDate symbol", () => {
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["schedule"] },
                            {
                                type: "wildcard",
                                variable: "event",
                                typeName: "string",
                            },
                            { type: "string", value: ["on"] },
                            {
                                type: "wildcard",
                                variable: "date",
                                typeName: "CalendarDate",
                            },
                        ],
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar, "calendar-test");

            const result = matchNFA(nfa, [
                "schedule",
                "meeting",
                "on",
                "tomorrow",
            ]);
            expect(result.matched).toBe(true);
            expect(result.captures.get("event")).toBe("meeting");

            const dateCapture = result.captures.get("date");
            expect(dateCapture).toBeInstanceOf(Date);
        });
    });

    describe("Cache Client Usage (Matching Only)", () => {
        it("should match without needing conversion", () => {
            // Cache client only needs to know if request matches
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["play"] },
                            {
                                type: "wildcard",
                                variable: "n",
                                typeName: "Ordinal",
                            },
                        ],
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar);

            // Cache just needs to know this matches
            const result = matchNFA(nfa, ["play", "first"]);
            expect(result.matched).toBe(true);
            // Cache doesn't need to use the converted value
        });
    });

    describe("Agent Client Usage (Matching + Conversion)", () => {
        it("should match and convert for agent use", () => {
            // Agent client needs converted values
            const grammar: Grammar = {
                rules: [
                    {
                        parts: [
                            { type: "string", value: ["schedule"] },
                            {
                                type: "wildcard",
                                variable: "event",
                                typeName: "string",
                            },
                            { type: "string", value: ["on"] },
                            { type: "string", value: ["the"] },
                            {
                                type: "wildcard",
                                variable: "day",
                                typeName: "Ordinal",
                            },
                        ],
                    },
                ],
            };

            const nfa = compileGrammarToNFA(grammar);
            const result = matchNFA(nfa, [
                "schedule",
                "meeting",
                "on",
                "the",
                "fifteenth",
            ]);

            expect(result.matched).toBe(true);

            // Agent uses captured values
            const eventName = result.captures.get("event") as string;
            const dayOfMonth = result.captures.get("day") as number;

            expect(eventName).toBe("meeting");
            expect(dayOfMonth).toBe(15);
            expect(typeof dayOfMonth).toBe("number");

            // Agent can now use these typed values
            // e.g., create a calendar event on the 15th day of the month
        });

        it("should handle agent parameter conversion", () => {
            // Simulate agent receiving a CalendarDate string parameter
            // and needing to convert it to a Date object

            const dateString = "2026-01-25";

            // Agent calls the converter helper
            const dateValue = convertCalendarDateValue(dateString);

            expect(dateValue).toBeInstanceOf(Date);
            expect(dateValue!.getFullYear()).toBe(2026);
            expect(dateValue!.getMonth()).toBe(0);
            expect(dateValue!.getDate()).toBe(25);

            // Agent can now use the Date object for calendar operations
        });
    });
});
