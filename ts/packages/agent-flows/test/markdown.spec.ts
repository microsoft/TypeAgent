// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    INDENT,
    SECTION_BREAK,
    escapeMarkdown,
    escapeCodeSpan,
    formatTimestamp,
} from "../src/index.js";

describe("markdown helpers", () => {
    test("INDENT is four non-breaking spaces", () => {
        expect(INDENT).toBe("&nbsp;&nbsp;&nbsp;&nbsp;");
    });

    test("SECTION_BREAK contains paragraph spacing + nbsp", () => {
        expect(SECTION_BREAK).toBe("\n\n&nbsp;\n\n");
    });

    describe("escapeMarkdown", () => {
        test("escapes the documented set of specials", () => {
            const input = "a\\b`c*d_e{f}g[h]i<j>k";
            const escaped = escapeMarkdown(input);
            // Every special should be preceded by a backslash.
            expect(escaped).toBe("a\\\\b\\`c\\*d\\_e\\{f\\}g\\[h\\]i\\<j\\>k");
        });

        test("leaves plain text unchanged", () => {
            expect(escapeMarkdown("hello world")).toBe("hello world");
        });
    });

    describe("escapeCodeSpan", () => {
        test("replaces every backtick with the HTML entity", () => {
            expect(escapeCodeSpan("a`b`c")).toBe("a&#96;b&#96;c");
        });

        test("leaves other markdown specials alone (only backticks matter inside a code span)", () => {
            expect(escapeCodeSpan("a*b_c[d]")).toBe("a*b_c[d]");
        });
    });

    describe("formatTimestamp", () => {
        test("undefined and null both yield 'unknown'", () => {
            expect(formatTimestamp(undefined)).toBe("unknown");
            expect(formatTimestamp(null)).toBe("unknown");
        });

        test("empty string yields 'unknown'", () => {
            expect(formatTimestamp("")).toBe("unknown");
        });

        test("unparseable string falls back to the original value", () => {
            expect(formatTimestamp("not a date")).toBe("not a date");
        });

        test("valid ISO string produces a non-empty human-readable string", () => {
            const out = formatTimestamp("2026-05-21T20:13:00Z");
            expect(typeof out).toBe("string");
            expect(out.length).toBeGreaterThan(0);
            expect(out).not.toBe("unknown");
            expect(out).not.toBe("2026-05-21T20:13:00Z");
            // Locale-dependent month abbreviation; spot-check year is present.
            expect(out).toMatch(/2026/);
        });
    });
});
