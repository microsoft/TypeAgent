// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Direct unit tests for `peekNextToken`.
 *
 * `peekNextToken` is the matcher's dispatch-time lookup helper: it
 * returns the next "token" (lowercased run of non-separator chars)
 * from `request` starting at `index`.  Two spacing modes govern
 * independent concerns:
 *
 *   - `leadingMode`: how to handle separators at `index`.
 *     `"none"` rejects a leading separator; everything else skips
 *     leading separators before extracting the run.
 *
 *   - `tokenMode`: how to determine the token boundary.  In `auto`
 *     mode (`undefined`) the run is truncated at the first
 *     non-word-boundary-script character; in any other mode the
 *     entire non-separator run is returned.
 *
 * These tests cover every meaningful combination of the two modes
 * plus the script-truncation edge cases (Latin↔CJK, Cyrillic↔CJK,
 * digit-leading, all-CJK input).
 */

import { peekNextToken } from "../src/grammarMatcher.js";

describe("peekNextToken", () => {
    // ── leadingMode handling ─────────────────────────────────────────
    //
    // In `"none"` mode a leading separator at `index` yields
    // `undefined`.  All other modes skip leading separators.

    it("none: rejects a leading separator", () => {
        expect(peekNextToken(" play", 0, "none", "none")).toBeUndefined();
    });

    it("none: accepts when the input starts on a non-separator", () => {
        expect(peekNextToken("play", 0, "none", "none")).toBe("play");
    });

    it("required: skips leading separators", () => {
        expect(peekNextToken("   play", 0, "required", "required")).toBe(
            "play",
        );
    });

    it("auto: skips leading separators", () => {
        expect(peekNextToken("   play", 0, undefined, undefined)).toBe("play");
    });

    it("returns undefined at end of input", () => {
        expect(peekNextToken("   ", 0, undefined, undefined)).toBeUndefined();
    });

    // ── tokenMode = required / optional / none ───────────────────────
    //
    // Non-auto token modes return the entire non-separator run
    // verbatim, including mixed-script content.

    it("required tokenMode: returns the full mixed-script run", () => {
        expect(peekNextToken("play你好 song", 0, "required", "required")).toBe(
            "play你好",
        );
    });

    it("required tokenMode: returns full digit-leading run", () => {
        expect(peekNextToken("1abc def", 0, "required", "required")).toBe(
            "1abc",
        );
    });

    it("required tokenMode: lowercases ASCII letters", () => {
        expect(peekNextToken("PLAY song", 0, "required", "required")).toBe(
            "play",
        );
    });

    it("none tokenMode: returns full run when leadingMode allows", () => {
        // leadingMode "none" plus a non-separator first char: the
        // entire non-separator run is returned (no auto truncation).
        expect(peekNextToken("play你好", 0, "none", "none")).toBe("play你好");
    });

    // ── tokenMode = auto: script-transition truncation ───────────────
    //
    // Auto mode truncates the run at the first non-word-boundary
    // script character.  When the leading char itself is non-WB,
    // the prefix is empty and peek returns undefined (so the
    // dispatch arm falls through to its fallback list).

    it("auto: truncates Latin → CJK at the script boundary", () => {
        expect(peekNextToken("play你好", 0, undefined, undefined)).toBe("play");
    });

    it("auto: truncates Cyrillic → CJK at the script boundary", () => {
        expect(peekNextToken("стоп你好", 0, undefined, undefined)).toBe("стоп");
    });

    it("auto: truncates Latin → digit at the script boundary", () => {
        // Digits are not in the word-boundary-script set, so an
        // ASCII letter run followed by digits truncates at the
        // first digit.
        expect(peekNextToken("abc123", 0, undefined, undefined)).toBe("abc");
    });

    it("auto: returns first code point for CJK-leading run", () => {
        // Option G: when the WB-script prefix is empty (CJK is not
        // a word-boundary script), peek falls back to the leading
        // code point so dispatch can still bucket on it.
        expect(peekNextToken("你好", 0, undefined, undefined)).toBe("你");
    });

    it("auto: returns first digit for digit-leading run", () => {
        // Option G: digits are not WB-script either; the leading
        // digit becomes the bucket key.
        expect(peekNextToken("123abc", 0, undefined, undefined)).toBe("1");
    });

    it("auto: returns single Hiragana code point for Hiragana-leading run", () => {
        expect(peekNextToken("さいせい", 0, undefined, undefined)).toBe("さ");
    });

    it("auto: returns single Katakana code point for Katakana-leading run", () => {
        expect(peekNextToken("カット", 0, undefined, undefined)).toBe("カ");
    });

    it("auto: returns supplementary code point as 2-UTF-16-unit string", () => {
        // U+1F3B5 (musical note) is encoded as a surrogate pair.
        // codePointAt(0) + fromCodePoint round-trips it as a
        // 2-UTF-16-unit token.
        expect(peekNextToken("🎵 song", 0, undefined, undefined)).toBe("🎵");
    });

    it("auto: returns full Latin run when there is no transition", () => {
        expect(peekNextToken("play song", 0, undefined, undefined)).toBe(
            "play",
        );
    });

    it("auto: lowercases the script-truncated prefix", () => {
        expect(peekNextToken("Play你好", 0, undefined, undefined)).toBe("play");
    });

    // ── leadingMode vs tokenMode: independent concerns ───────────────
    //
    // Splitting the two modes lets the dispatch arm honor the
    // surrounding rule's leading-separator policy independently of
    // the dispatched member rules' token boundary.  These tests
    // exercise each cross-product pair.

    it("leading=none + token=auto: rejects leading separator", () => {
        // Even though tokenMode is auto, leading separator under
        // none mode is illegal; should return undefined before any
        // truncation logic runs.
        expect(
            peekNextToken(" play你好", 0, "none", undefined),
        ).toBeUndefined();
    });

    it("leading=none + token=auto: succeeds when no leading separator", () => {
        // No leading separator → token extracted, then auto
        // truncation cuts at the script boundary.
        expect(peekNextToken("play你好", 0, "none", undefined)).toBe("play");
    });

    it("leading=auto + token=required: skip leading sep, no truncation", () => {
        // Auto leading mode skips the separator; required token
        // mode returns the full run (no script-transition cut).
        expect(peekNextToken(" play你好", 0, undefined, "required")).toBe(
            "play你好",
        );
    });

    it("leading=required + token=auto: skip leading sep, auto truncation", () => {
        expect(peekNextToken(" play你好", 0, "required", undefined)).toBe(
            "play",
        );
    });

    it("leading=required + token=required: skip sep, full run", () => {
        expect(peekNextToken(" play你好", 0, "required", "required")).toBe(
            "play你好",
        );
    });

    // ── Index handling ───────────────────────────────────────────────

    it("respects a non-zero start index", () => {
        // Start past the leading "foo " - should peek the next
        // token from there.
        expect(peekNextToken("foo bar baz", 4, undefined, undefined)).toBe(
            "bar",
        );
    });

    it("returns undefined when index is at end of input", () => {
        expect(peekNextToken("play", 4, undefined, undefined)).toBeUndefined();
    });

    it("returns undefined when only separators remain after index", () => {
        expect(
            peekNextToken("play   ", 4, undefined, undefined),
        ).toBeUndefined();
    });
});
