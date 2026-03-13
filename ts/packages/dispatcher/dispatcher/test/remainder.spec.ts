// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseParams } from "../src/command/parameters.js";

describe("remainderLength", () => {
    // ----- Parameter definitions reused across tests -----
    const singleArg = {
        args: {
            name: { description: "a name" },
        },
    } as const;

    const twoArgs = {
        args: {
            first: { description: "first" },
            second: { description: "second" },
        },
    } as const;

    const multipleArg = {
        args: {
            items: { description: "items", multiple: true },
        },
    } as const;

    const multipleAndSingle = {
        args: {
            items: { description: "items", multiple: true },
            last: { description: "last", optional: true },
        },
    } as const;

    const strFlag = {
        flags: {
            str: { description: "string flag", type: "string" },
        },
    } as const;

    const numFlag = {
        flags: {
            num: { description: "number flag", type: "number" },
        },
    } as const;

    const boolFlag = {
        flags: {
            bool: { description: "boolean flag", type: "boolean" },
        },
    } as const;

    const flagsAndArgs = {
        flags: {
            bool: { description: "boolean flag", type: "boolean" },
        },
        args: {
            name: { description: "a name" },
        },
    } as const;

    const implicitQuoteArg = {
        args: {
            text: { description: "text", implicitQuotes: true },
        },
    };

    const optionalArg = {
        args: {
            name: { description: "a name", optional: true },
        },
    } as const;

    // ---- Non-partial mode (entire input consumed → 0) ----

    describe("non-partial", () => {
        it("empty input", () => {
            expect(parseParams("", optionalArg).remainderLength).toBe(0);
        });

        it("single argument consumed", () => {
            expect(parseParams("hello", singleArg).remainderLength).toBe(0);
        });

        it("two arguments consumed", () => {
            expect(parseParams("hello world", twoArgs).remainderLength).toBe(0);
        });

        it("multiple arguments consumed", () => {
            expect(parseParams("a b c", multipleArg).remainderLength).toBe(0);
        });

        it("flag with string value consumed", () => {
            expect(parseParams("--str value", strFlag).remainderLength).toBe(0);
        });

        it("boolean flag consumed", () => {
            expect(parseParams("--bool", boolFlag).remainderLength).toBe(0);
        });

        it("boolean flag with explicit true consumed", () => {
            expect(parseParams("--bool true", boolFlag).remainderLength).toBe(
                0,
            );
        });

        it("flags and args consumed", () => {
            expect(
                parseParams("--bool hello", flagsAndArgs).remainderLength,
            ).toBe(0);
        });

        it("quoted argument consumed", () => {
            expect(
                parseParams("'hello world'", singleArg).remainderLength,
            ).toBe(0);
        });

        it("whitespace-padded input trimmed and consumed", () => {
            expect(parseParams("  hello  ", singleArg).remainderLength).toBe(0);
        });

        it("implicit quote argument consumes rest of line", () => {
            expect(
                parseParams("hello   world  extra", implicitQuoteArg)
                    .remainderLength,
            ).toBe(0);
        });

        it("separator between multiple and single arg", () => {
            expect(
                parseParams("a b -- c", multipleAndSingle).remainderLength,
            ).toBe(0);
        });

        it("flag with value plus argument consumed", () => {
            expect(
                parseParams("--str value hello", {
                    flags: { str: { description: "s", type: "string" } },
                    args: { name: { description: "n" } },
                } as const).remainderLength,
            ).toBe(0);
        });
    });

    // ---- Partial mode — fully consumed ----

    describe("partial - fully consumed", () => {
        it("empty input", () => {
            expect(parseParams("", optionalArg, true).remainderLength).toBe(0);
        });

        it("single argument", () => {
            expect(parseParams("hello", singleArg, true).remainderLength).toBe(
                0,
            );
        });

        it("flag with value", () => {
            expect(
                parseParams("--str value", strFlag, true).remainderLength,
            ).toBe(0);
        });

        it("boolean flag without value", () => {
            expect(parseParams("--bool", boolFlag, true).remainderLength).toBe(
                0,
            );
        });

        it("trailing whitespace after completed arg", () => {
            expect(parseParams("hello ", singleArg, true).remainderLength).toBe(
                0,
            );
        });

        it("multiple arguments", () => {
            expect(
                parseParams("a b c", multipleArg, true).remainderLength,
            ).toBe(0);
        });

        it("flags and args", () => {
            expect(
                parseParams("--bool hello", flagsAndArgs, true).remainderLength,
            ).toBe(0);
        });
    });

    // ---- Partial mode — partially consumed ----

    describe("partial - partially consumed", () => {
        it("too many arguments leaves remainder", () => {
            const result = parseParams("hello extra", singleArg, true);
            expect(result.remainderLength).toBe("extra".length);
        });

        it("invalid flag leaves full input as remainder", () => {
            const result = parseParams("--unknown", strFlag, true);
            expect(result.remainderLength).toBe("--unknown".length);
        });

        it("string flag missing value with next flag-like token", () => {
            // --str consumed as flag name, but --other is not a valid value
            // so curr is rolled back to "--other"
            const result = parseParams("--str --other", strFlag, true);
            expect(result.remainderLength).toBe("--other".length);
        });

        it("string flag missing value at end of input", () => {
            // Flag name consumed, no more input → remainder is 0
            const result = parseParams("--str", strFlag, true);
            expect(result.remainderLength).toBe(0);
        });

        it("number flag with non-numeric value", () => {
            // --num consumed as flag name, "abc" fails number parse and
            // is rolled back
            const result = parseParams("--num abc", numFlag, true);
            expect(result.remainderLength).toBe("abc".length);
        });

        it("boolean flag defaults true then extra has no arg def", () => {
            // --bool consumed with default true, "extra" has no arg def
            const result = parseParams("--bool extra", boolFlag, true);
            expect(result.remainderLength).toBe("extra".length);
        });

        it("multiple arg terminated by invalid flag-like token", () => {
            const result = parseParams("a b --bad", multipleArg, true);
            expect(result.remainderLength).toBe("--bad".length);
        });

        it("two valid args then too many", () => {
            const result = parseParams("hello world extra", twoArgs, true);
            expect(result.remainderLength).toBe("extra".length);
        });

        it("valid flag+value then invalid flag", () => {
            const result = parseParams("--str hello --unknown", strFlag, true);
            expect(result.remainderLength).toBe("--unknown".length);
        });

        it("leading whitespace is trimmed before measuring", () => {
            // partial trims only the start; "extra" is 5 chars
            const result = parseParams("  hello extra", singleArg, true);
            expect(result.remainderLength).toBe("extra".length);
        });
    });
});
