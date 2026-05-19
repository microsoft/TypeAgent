// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { lex, TokenKind } from "../src/lexer.js";

function kinds(source: string): TokenKind[] {
    const { tokens } = lex(source);
    return tokens.map((t) => t.kind).filter((k) => k !== TokenKind.EOF);
}

function values(source: string): string[] {
    const { tokens } = lex(source);
    return tokens.filter((t) => t.kind !== TokenKind.EOF).map((t) => t.value);
}

describe("lexer", () => {
    // ---- Keywords ----

    test("keywords", () => {
        const src =
            "workflow const if else switch case default return break throw";
        expect(kinds(src)).toEqual([
            TokenKind.Workflow,
            TokenKind.Const,
            TokenKind.If,
            TokenKind.Else,
            TokenKind.Switch,
            TokenKind.Case,
            TokenKind.Default,
            TokenKind.Return,
            TokenKind.Break,
            TokenKind.Throw,
        ]);
    });

    test("removed v1 keywords are now identifiers", () => {
        const src = "let while for of try catch continue match";
        const result = lex(src);
        for (const t of result.tokens) {
            if (t.kind !== TokenKind.EOF) {
                expect(t.kind).toBe(TokenKind.Identifier);
            }
        }
    });

    // ---- Literals ----

    test("boolean literals", () => {
        const { tokens } = lex("true false");
        expect(tokens[0].kind).toBe(TokenKind.BooleanLiteral);
        expect(tokens[0].value).toBe("true");
        expect(tokens[1].kind).toBe(TokenKind.BooleanLiteral);
        expect(tokens[1].value).toBe("false");
    });

    test("null literal", () => {
        const { tokens } = lex("null");
        expect(tokens[0].kind).toBe(TokenKind.NullLiteral);
    });

    test("number literals", () => {
        expect(values("42")).toEqual(["42"]);
        expect(values("3.14")).toEqual(["3.14"]);
    });

    test("negative number in value context", () => {
        const { tokens } = lex("= -5");
        expect(tokens[1].kind).toBe(TokenKind.NumberLiteral);
        expect(tokens[1].value).toBe("-5");
    });

    test("minus as operator in expression context", () => {
        const { tokens } = lex("x - 5");
        expect(tokens[1].kind).toBe(TokenKind.Minus);
    });

    test("string literals with escapes (raw-only: escapes not decoded)", () => {
        const { tokens } = lex('"hello\\nworld"');
        const t = tokens[0];
        expect(t.kind).toBe(TokenKind.StringLiteral);
        // The lexer captures the raw source between the delimiters; escape
        // processing is the consumer's job (via decodeStringLiteral).
        expect(t.value).toBe("hello\\nworld");
        if (t.kind === TokenKind.StringLiteral) expect(t.quote).toBe('"');
    });

    test("single-quoted strings", () => {
        const { tokens } = lex("'abc'");
        const t = tokens[0];
        expect(t.kind).toBe(TokenKind.StringLiteral);
        expect(t.value).toBe("abc");
        if (t.kind === TokenKind.StringLiteral) expect(t.quote).toBe("'");
    });

    test("string line continuation with CRLF after backslash is accepted", () => {
        const src = 'workflow w(): string { const s = "a\\\r\nb"; return s; }';
        const { errors, tokens } = lex(src);
        expect(errors).toEqual([]);
        const stringTok = tokens.find(
            (t) => t.kind === TokenKind.StringLiteral,
        );
        expect(stringTok).toBeDefined();
        expect(stringTok!.value).toBe("a\\\r\nb");
    });

    // ---- Template literals ----

    test("template literal with no interpolation", () => {
        const { tokens } = lex("`hello`");
        expect(tokens[0].kind).toBe(TokenKind.TemplateNoSub);
        expect(tokens[0].value).toBe("hello");
    });

    test("template literal with interpolation", () => {
        const { tokens } = lex("`hello ${name}!`");
        expect(tokens[0].kind).toBe(TokenKind.TemplateHead);
        expect(tokens[0].value).toBe("hello ");
        expect(tokens[1].kind).toBe(TokenKind.Identifier);
        expect(tokens[1].value).toBe("name");
        expect(tokens[2].kind).toBe(TokenKind.TemplateTail);
        expect(tokens[2].value).toBe("!");
    });

    test("template literal with multiple interpolations", () => {
        const { tokens } = lex("`a${b}c${d}e`");
        expect(tokens[0].kind).toBe(TokenKind.TemplateHead);
        expect(tokens[0].value).toBe("a");
        expect(tokens[1].kind).toBe(TokenKind.Identifier);
        expect(tokens[2].kind).toBe(TokenKind.TemplateMiddle);
        expect(tokens[2].value).toBe("c");
        expect(tokens[3].kind).toBe(TokenKind.Identifier);
        expect(tokens[4].kind).toBe(TokenKind.TemplateTail);
        expect(tokens[4].value).toBe("e");
    });

    // ---- Comparison operators ----

    test("=== operator", () => {
        expect(kinds("a === b")).toEqual([
            TokenKind.Identifier,
            TokenKind.TripleEquals,
            TokenKind.Identifier,
        ]);
    });

    test("!== operator", () => {
        expect(kinds("a !== b")).toEqual([
            TokenKind.Identifier,
            TokenKind.NotTripleEquals,
            TokenKind.Identifier,
        ]);
    });

    test("== produces error", () => {
        const { errors } = lex("a == b");
        expect(errors.length).toBe(1);
        expect(errors[0].message).toContain("===");
    });

    test("!= produces error", () => {
        const { errors } = lex("a != b");
        expect(errors.length).toBe(1);
        expect(errors[0].message).toContain("!==");
    });

    test("> < >= <= operators", () => {
        expect(kinds("a > b < c >= d <= e")).toEqual([
            TokenKind.Identifier,
            TokenKind.GreaterThan,
            TokenKind.Identifier,
            TokenKind.LessThan,
            TokenKind.Identifier,
            TokenKind.GreaterOrEqual,
            TokenKind.Identifier,
            TokenKind.LessOrEqual,
            TokenKind.Identifier,
        ]);
    });

    // ---- Logical operators ----

    test("&& and || operators", () => {
        expect(kinds("a && b || c")).toEqual([
            TokenKind.Identifier,
            TokenKind.And,
            TokenKind.Identifier,
            TokenKind.Or,
            TokenKind.Identifier,
        ]);
    });

    test("single & produces error", () => {
        const { errors } = lex("a & b");
        expect(errors.length).toBe(1);
        expect(errors[0].message).toContain("&&");
    });

    test("single | produces error", () => {
        const { errors } = lex("a | b");
        expect(errors.length).toBe(1);
        expect(errors[0].message).toContain("||");
    });

    test("! operator", () => {
        expect(kinds("!x")).toEqual([TokenKind.Not, TokenKind.Identifier]);
    });

    // ---- Arithmetic operators ----

    test("+ - * / % operators", () => {
        expect(kinds("a + b - c * d / e % f")).toEqual([
            TokenKind.Identifier,
            TokenKind.Plus,
            TokenKind.Identifier,
            TokenKind.Minus,
            TokenKind.Identifier,
            TokenKind.Star,
            TokenKind.Identifier,
            TokenKind.Slash,
            TokenKind.Identifier,
            TokenKind.Percent,
            TokenKind.Identifier,
        ]);
    });

    // ---- Punctuation ----

    test("arrow =>", () => {
        expect(kinds("() => x")).toEqual([
            TokenKind.LParen,
            TokenKind.RParen,
            TokenKind.Arrow,
            TokenKind.Identifier,
        ]);
    });

    test("? for ternary", () => {
        expect(kinds("a ? b : c")).toEqual([
            TokenKind.Identifier,
            TokenKind.QuestionMark,
            TokenKind.Identifier,
            TokenKind.Colon,
            TokenKind.Identifier,
        ]);
    });

    test("semicolons", () => {
        expect(kinds("x;")).toEqual([
            TokenKind.Identifier,
            TokenKind.Semicolon,
        ]);
    });

    // ---- Comments ----

    test("line comments are skipped", () => {
        const src = "a // comment\nb";
        expect(kinds(src)).toEqual([
            TokenKind.Identifier,
            TokenKind.Identifier,
        ]);
    });

    test("block comments are skipped", () => {
        const src = "a /* block */ b";
        expect(kinds(src)).toEqual([
            TokenKind.Identifier,
            TokenKind.Identifier,
        ]);
    });

    // ---- Position tracking ----

    test("tracks line and column", () => {
        const { tokens } = lex("a\nb");
        expect(tokens[0].line).toBe(1);
        expect(tokens[0].col).toBe(1);
        expect(tokens[1].line).toBe(2);
        expect(tokens[1].col).toBe(1);
    });

    // ---- Edge cases ----

    test("unterminated string", () => {
        const { errors } = lex('"hello');
        expect(errors.length).toBe(1);
        expect(errors[0].message).toContain("Unterminated string");
    });

    test("unterminated template literal", () => {
        const { errors } = lex("`hello");
        expect(errors.length).toBe(1);
        expect(errors[0].message).toContain("Unterminated template");
    });

    test("empty source", () => {
        const { tokens, errors } = lex("");
        expect(errors).toEqual([]);
        expect(tokens.length).toBe(1);
        expect(tokens[0].kind).toBe(TokenKind.EOF);
    });

    test("division vs comment", () => {
        // a / b should lex as identifier, slash, identifier
        expect(kinds("a / b")).toEqual([
            TokenKind.Identifier,
            TokenKind.Slash,
            TokenKind.Identifier,
        ]);
    });

    test("negative number after comma", () => {
        const { tokens } = lex("[1, -2, -3]");
        const nums = tokens.filter((t) => t.kind === TokenKind.NumberLiteral);
        expect(nums.map((n) => n.value)).toEqual(["1", "-2", "-3"]);
    });

    test("negative number after colon", () => {
        const { tokens } = lex("x: -5");
        expect(tokens[2].kind).toBe(TokenKind.NumberLiteral);
        expect(tokens[2].value).toBe("-5");
    });

    test("negative number after arrow", () => {
        const { tokens } = lex("=> -1");
        expect(tokens[1].kind).toBe(TokenKind.NumberLiteral);
        expect(tokens[1].value).toBe("-1");
    });

    test("dot operator", () => {
        expect(kinds("a.b")).toEqual([
            TokenKind.Identifier,
            TokenKind.Dot,
            TokenKind.Identifier,
        ]);
    });

    test("brackets", () => {
        expect(kinds("a[0]")).toEqual([
            TokenKind.Identifier,
            TokenKind.LBracket,
            TokenKind.NumberLiteral,
            TokenKind.RBracket,
        ]);
    });

    test("equals sign", () => {
        expect(kinds("x = 1")).toEqual([
            TokenKind.Identifier,
            TokenKind.Equals,
            TokenKind.NumberLiteral,
        ]);
    });

    // ---- Comment collection (G8) ----
    //
    // These tests guard the LexComment collector: regressions here would
    // either drop comments from format() output or corrupt position
    // tracking for tokens following multi-line block comments.

    test("line comment at EOF (no trailing newline) is captured", () => {
        const { comments, errors } = lex("a // tail");
        expect(errors).toEqual([]);
        expect(comments).toHaveLength(1);
        expect(comments[0]).toMatchObject({
            text: "// tail",
            block: false,
        });
    });

    test("block comment containing // is captured verbatim", () => {
        const { comments, errors } = lex("/* abc // not-a-line-comment */ x");
        expect(errors).toEqual([]);
        expect(comments).toHaveLength(1);
        expect(comments[0].text).toBe("/* abc // not-a-line-comment */");
        expect(comments[0].block).toBe(true);
    });

    test("multi-line block comment is captured verbatim (newlines preserved)", () => {
        const src = "/*\n line1\n line2\n*/\nx";
        const { comments, tokens, errors } = lex(src);
        expect(errors).toEqual([]);
        expect(comments).toHaveLength(1);
        expect(comments[0].text).toBe("/*\n line1\n line2\n*/");
        // Token after the multi-line block comment should be on line 5.
        const x = tokens.find((t) => t.value === "x");
        expect(x?.line).toBe(5);
    });

    test("unterminated block comment: error reported AND comment captured", () => {
        const { errors, comments } = lex("/* unterminated");
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain("Unterminated block comment");
        // The collector still records the text seen so a formatter can
        // round-trip best-effort and the gap doesn't silently swallow input.
        expect(comments).toHaveLength(1);
        expect(comments[0].text).toBe("/* unterminated");
        expect(comments[0].block).toBe(true);
    });

    describe("invalid escape sequences surface as lex errors", () => {
        // JS strict mode rejects these at parse time; the lexer mirrors
        // that so the emitter never has to silently substitute a
        // default cooked value.
        test("string: invalid \\x hex escape is a lex error", () => {
            const { errors } = lex('const x = "\\xZZ";');
            expect(errors).toHaveLength(1);
            expect(errors[0].message).toMatch(/hex escape/i);
            // Points at the offending `\` (column 12: after `const x = "`).
            expect(errors[0].line).toBe(1);
            expect(errors[0].col).toBe(12);
        });

        test("string: invalid \\u unicode escape is a lex error", () => {
            const { errors } = lex('const x = "\\uZZZZ";');
            expect(errors).toHaveLength(1);
            expect(errors[0].message).toMatch(/unicode escape/i);
        });

        test("string: legacy octal escape is a lex error in strict mode", () => {
            const { errors } = lex('const x = "\\7";');
            expect(errors).toHaveLength(1);
            expect(errors[0].message).toMatch(/octal/i);
        });

        test("template: invalid \\x hex escape is a lex error", () => {
            const { errors } = lex("const x = `bad: \\xZZ`;");
            expect(errors).toHaveLength(1);
            expect(errors[0].message).toMatch(/hex escape/i);
        });

        test("template: error line tracks raw newlines in the span", () => {
            const { errors } = lex("const x = `line1\nline2 \\xZZ`;");
            expect(errors).toHaveLength(1);
            expect(errors[0].line).toBe(2);
        });

        test("valid escapes still produce zero errors", () => {
            const { errors } = lex(
                'const x = "\\x41\\u00e9\\u{1F600}\\n\\t\\\\";',
            );
            expect(errors).toEqual([]);
        });
    });
});
