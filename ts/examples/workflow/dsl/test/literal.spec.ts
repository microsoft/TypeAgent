// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { decodeStringLiteral, decodeTemplatePart } from "../src/literal.js";
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
