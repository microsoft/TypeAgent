// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    decodeStringLiteral,
    decodeTemplatePart,
    encodeStringLiteral,
} from "../src/literal.js";
import { lex } from "../src/lexer.js";

function dq(raw: string) {
    return decodeStringLiteral(raw, '"');
}
function sq(raw: string) {
    return decodeStringLiteral(raw, "'");
}
function bt(raw: string) {
    return decodeStringLiteral(raw, "`");
}

describe("literal decoder: SingleEscapeCharacter (JS strict-mode parity)", () => {
    test.each([
        ["\\b", "\b"],
        ["\\f", "\f"],
        ["\\n", "\n"],
        ["\\r", "\r"],
        ["\\t", "\t"],
        ["\\v", "\v"],
        ["\\\\", "\\"],
    ])("'%s' decodes to the right code point", (raw, cooked) => {
        const r = dq(raw);
        expect(r.errors).toEqual([]);
        expect(r.value).toBe(cooked);
    });

    test('\\" decodes to U+0022 inside a double-quoted string', () => {
        const r = dq('\\"');
        expect(r.errors).toEqual([]);
        expect(r.value).toBe('"');
    });

    test("\\' decodes to U+0027 inside a single-quoted string", () => {
        const r = sq("\\'");
        expect(r.errors).toEqual([]);
        expect(r.value).toBe("'");
    });

    test("\\` decodes to U+0060 inside a template", () => {
        const r = decodeTemplatePart("\\`");
        expect(r.errors).toEqual([]);
        expect(r.value).toBe("`");
    });

    test("\\${ in templates produces literal '${'", () => {
        const r = decodeTemplatePart("\\${x}");
        expect(r.errors).toEqual([]);
        expect(r.value).toBe("${x}");
    });
});

describe("literal decoder: hex / unicode escapes", () => {
    test("\\xHH decodes a Latin-1 code point", () => {
        const r = dq("\\x41\\x7a");
        expect(r.errors).toEqual([]);
        expect(r.value).toBe("Az");
    });

    test("\\xH<non-hex> is a parse error", () => {
        const r = dq("\\xZZ");
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0].message).toMatch(/hex escape/i);
    });

    // The next three tests pin the JS NotEscapeSequence recovery rule
    // for `\x`: consume `\x` plus any partially-matched hex digit, drop
    // the bad escape's cooked value, and re-enter the scanner so the
    // remaining text is parsed normally.
    test("\\x followed by non-hex consumes only `\\x` and continues", () => {
        // `\xZA`: Z is non-hex -> consume `\x`, leave `ZA` as text.
        const r = dq("\\xZA");
        expect(r.errors).toHaveLength(1);
        expect(r.value).toBe("ZA");
    });

    test("\\xH<non-hex> consumes `\\xH` (the matched hex digit too)", () => {
        // `\x4Z`: 4 is hex, Z is non-hex -> consume `\x4`, leave `Z`.
        const r = dq("\\x4Z");
        expect(r.errors).toHaveLength(1);
        expect(r.value).toBe("Z");
    });

    test("\\x at end of raw input is reported and consumes only `\\x`", () => {
        const r = dq("\\x");
        expect(r.errors).toHaveLength(1);
        expect(r.value).toBe("");
    });

    test("\\uHHHH decodes a BMP code point", () => {
        const r = dq("\\u00e9");
        expect(r.errors).toEqual([]);
        expect(r.value).toBe("\u00e9");
    });

    test("\\u{H..H} decodes any Unicode code point including astral", () => {
        const r = dq("\\u{1F600}");
        expect(r.errors).toEqual([]);
        expect(r.value).toBe("\u{1F600}");
    });

    test("\\u{} (no hex digits) is a parse error", () => {
        const r = dq("\\u{}");
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0].message).toMatch(/unicode escape/i);
    });

    test("\\u{...} above U+10FFFF is a parse error", () => {
        const r = dq("\\u{110000}");
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0].message).toMatch(/out of range/i);
    });

    test("\\uXY is a parse error (need 4 hex digits)", () => {
        const r = dq("\\uXY");
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0].message).toMatch(/unicode escape/i);
    });
});

describe("literal decoder: octal escapes are forbidden in strict mode", () => {
    test("\\0 alone decodes to NUL", () => {
        const r = dq("\\0");
        expect(r.errors).toEqual([]);
        expect(r.value).toBe("\u0000");
    });

    test("\\0 followed by a digit is a parse error", () => {
        const r = dq("\\08");
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0].message).toMatch(/octal/i);
    });

    test.each(["\\1", "\\2", "\\7", "\\9"])("'%s' is a parse error", (raw) => {
        const r = dq(raw);
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0].message).toMatch(/octal/i);
    });
});

describe("literal decoder: line continuation", () => {
    test("\\<LF> consumes both and produces no output", () => {
        const r = dq("a\\\nb");
        expect(r.errors).toEqual([]);
        expect(r.value).toBe("ab");
    });

    test("\\<CRLF> is a single LineTerminatorSequence", () => {
        const r = dq("a\\\r\nb");
        expect(r.errors).toEqual([]);
        expect(r.value).toBe("ab");
    });

    test("\\<CR> alone is also a line continuation", () => {
        const r = dq("a\\\rb");
        expect(r.errors).toEqual([]);
        expect(r.value).toBe("ab");
    });
});

describe("literal decoder: NonEscapeCharacter (lenient by spec)", () => {
    test("\\q -> q (NonEscapeCharacter is allowed in strict mode)", () => {
        const r = dq("\\q");
        expect(r.errors).toEqual([]);
        expect(r.value).toBe("q");
    });

    test("\\@ -> @", () => {
        const r = dq("\\@");
        expect(r.errors).toEqual([]);
        expect(r.value).toBe("@");
    });
});

describe("literal decoder: trailing backslash", () => {
    test("returns an error and still emits the lone backslash", () => {
        const r = dq("a\\");
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0].message).toMatch(/trailing backslash/i);
        expect(r.value).toBe("a\\");
    });
});

describe("lexer: raw line terminators in string literals are rejected", () => {
    test("raw LF inside a double-quoted string is a lex error", () => {
        const { errors } = lex('const x = "a\nb";');
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].message).toMatch(/unterminated|newline/i);
    });

    test("raw LF inside a single-quoted string is a lex error", () => {
        const { errors } = lex("const x = 'a\nb';");
        expect(errors.length).toBeGreaterThan(0);
    });

    test("\\<LF> line continuation is accepted by the lexer", () => {
        const { errors } = lex('const x = "a\\\nb";');
        expect(errors).toEqual([]);
    });

    test("raw LF inside a template literal is allowed", () => {
        const { errors } = lex("const x = `a\nb`;");
        expect(errors).toEqual([]);
    });
});

describe("decodeStringLiteral dispatches to template rules for backtick", () => {
    test("backtick quote treats \\${ as literal ${", () => {
        const r = bt("\\${x}");
        expect(r.errors).toEqual([]);
        expect(r.value).toBe("${x}");
    });
});

describe("encodeStringLiteral / decodeStringLiteral round-trip", () => {
    // Deterministic pseudo-random string generator. Avoids pulling in
    // fast-check just for this property test, but still covers a wide
    // surface: every Unicode escape edge case (controls, quotes,
    // backslashes, surrogate pairs, dollar-brace inside backticks).
    function mulberry32(seed: number): () => number {
        let s = seed >>> 0;
        return () => {
            s = (s + 0x6d2b79f5) >>> 0;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    const sample =
        "abcXYZ012 \\\"'`${}\b\f\n\r\t\v\0\x01\x1f\x7f\u00ff\u2028\u{1f600}";

    function makeString(rng: () => number, maxLen: number): string {
        const len = Math.floor(rng() * maxLen);
        const out: string[] = [];
        for (let i = 0; i < len; i++) {
            const idx = Math.floor(rng() * sample.length);
            out.push(sample[idx]);
        }
        return out.join("");
    }

    const quotes: Array<"'" | '"' | "`"> = ["'", '"', "`"];

    for (const q of quotes) {
        test(`round-trip preserves arbitrary strings (quote=${q})`, () => {
            const rng = mulberry32(0xc0ffee ^ q.charCodeAt(0));
            for (let trial = 0; trial < 500; trial++) {
                const input = makeString(rng, 24);
                const encoded = encodeStringLiteral(input, q);
                // Re-decode using the matching delimiter rules.
                const { value, errors } = decodeStringLiteral(encoded, q);
                expect(errors).toEqual([]);
                expect(value).toBe(input);
            }
        });
    }

    test("handcrafted edge cases survive a round trip in all quote styles", () => {
        const cases = [
            "",
            "\\",
            '"',
            "'",
            "`",
            "${x}",
            "\\${",
            "\n",
            "\r\n",
            "\t\v\f\b",
            "\0\x01\x1f\x7f",
            "mixed \\ ' \" ` ${ } end",
            "\u{1f600}\u2028\u00ff",
        ];
        for (const q of quotes) {
            for (const input of cases) {
                const encoded = encodeStringLiteral(input, q);
                const { value, errors } = decodeStringLiteral(encoded, q);
                expect(errors).toEqual([]);
                expect(value).toBe(input);
            }
        }
    });
});
