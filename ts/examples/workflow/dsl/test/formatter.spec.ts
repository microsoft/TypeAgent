// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { lex } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { format } from "../src/formatter.js";
import { compile } from "../src/compiler.js";
import { WorkflowDecl } from "../src/ast.js";

function parse(source: string): WorkflowDecl {
    const { tokens, errors: lexErrors, comments } = lex(source);
    expect(lexErrors).toEqual([]);
    const parser = new Parser(tokens, comments);
    const { ast, errors } = parser.parseSingle();
    expect(errors).toEqual([]);
    expect(ast).toBeDefined();
    return ast!;
}

function roundTrip(source: string): string {
    return format(parse(source));
}

/** Parse, format, parse again, format again -> formats should be equal. */
function assertStable(source: string): string {
    const once = roundTrip(source);
    const twice = format(parse(once));
    expect(twice).toBe(once);
    return once;
}

describe("formatter: comment preservation (G8)", () => {
    test("lexer collects line and block comments", () => {
        const { comments } = lex(`// hi
/* block */ a`);
        expect(comments).toHaveLength(2);
        expect(comments[0]).toMatchObject({ text: "// hi", block: false });
        expect(comments[1]).toMatchObject({ text: "/* block */", block: true });
    });

    test("parser attaches leading line comment to workflow", () => {
        const wf = parse(`// header comment
workflow w(): string { return "x"; }`);
        expect(wf.leadingComments).toHaveLength(1);
        expect(wf.leadingComments![0].text).toBe("// header comment");
    });

    test("parser attaches multiple leading comments to a statement", () => {
        const wf = parse(`workflow w(): string {
    // first
    // second
    const x = "a";
    return x;
}`);
        const first = wf.body[0];
        expect(first.leadingComments).toHaveLength(2);
        expect(first.leadingComments![0].text).toBe("// first");
        expect(first.leadingComments![1].text).toBe("// second");
    });

    test("block comment attaches as leading", () => {
        const wf = parse(`workflow w(): string {
    /* note */
    const x = "a";
    return x;
}`);
        expect(wf.body[0].leadingComments?.[0].text).toBe("/* note */");
    });

    test("comments survive round trip", () => {
        const out = roundTrip(`// header
workflow w(): string {
    // step 1
    const x = "a";
    return x;
}`);
        expect(out).toContain("// header");
        expect(out).toContain("// step 1");
    });
});

describe("formatter: round-trip stability", () => {
    test("trivial workflow", () => {
        const out = assertStable(`workflow w(): string { return "x"; }`);
        expect(out).toContain("workflow w(): string {");
        expect(out).toContain('return "x";');
    });

    test("const + return", () => {
        assertStable(`workflow w(a: string): string {
            const x = a;
            return x;
        }`);
    });

    test("if/else", () => {
        assertStable(`workflow w(a: boolean): string {
            if (a) { return "y"; } else { return "n"; }
        }`);
    });

    test("else-if chain", () => {
        const out = assertStable(`workflow w(a: number): string {
            if (a === 1) { return "one"; } else if (a === 2) { return "two"; } else { return "other"; }
        }`);
        expect(out).toMatch(/} else if \(/);
    });

    test("switch", () => {
        assertStable(`workflow w(a: string): string {
            switch (a) {
                case "x": return "x";
                case "y": return "y";
                default: return "z";
            }
        }`);
    });

    test("binary operator precedence preserved", () => {
        const wf = parse(`workflow w(): number { return 1 + 2 * 3; }`);
        const out = format(wf);
        // Multiplication has higher precedence; no parens needed
        expect(out).toContain("return 1 + 2 * 3;");
        assertStable(`workflow w(): number { return 1 + 2 * 3; }`);
    });

    test("binary operator: parens added when needed", () => {
        const wf = parse(`workflow w(): number { return (1 + 2) * 3; }`);
        const out = format(wf);
        expect(out).toContain("(1 + 2) * 3");
    });

    test("ternary", () => {
        assertStable(
            `workflow w(a: boolean): string { return a ? "y" : "n"; }`,
        );
    });

    test("template literal", () => {
        const wf = parse(
            "workflow w(n: string): string { return `hello ${n}!`; }",
        );
        const out = format(wf);
        expect(out).toContain("`hello ${n}!`");
    });

    test("array literal", () => {
        const out = roundTrip(`workflow w(): number[] { return [1, 2, 3]; }`);
        expect(out).toContain("[1, 2, 3]");
    });

    test("object literal", () => {
        const out = roundTrip(
            `workflow w(): { a: number, b: string } { return { a: 1, b: "x" }; }`,
        );
        expect(out).toContain('{ a: 1, b: "x" }');
    });

    test("attempts node", () => {
        assertStable(`workflow w(): string {
            const r = attempts(2, () => { return http.get({ url: "x" }); });
            return r;
        }`);
    });

    test("attempts with fallback", () => {
        const out = assertStable(`workflow w(): string {
            const r = attempts(2, () => { return http.get({ url: "x" }); }, (err) => { return "fallback"; });
            return r;
        }`);
        expect(out).toContain("(err) =>");
    });

    test("map builtin", () => {
        assertStable(`workflow w(items: string[]): string[] {
            const r = map(items, (item) => { return item; });
            return r;
        }`);
    });

    test("parallel builtin", () => {
        assertStable(`workflow w(): string {
            const [a, b] = parallel(() => { return "x"; }, () => { return "y"; });
            return a;
        }`);
    });

    test("destructuring const", () => {
        const out = roundTrip(`workflow w(): string {
            const [a, b] = parallel(() => { return "x"; }, () => { return "y"; });
            return a;
        }`);
        expect(out).toContain("const [a, b] = parallel(");
    });

    test("user variable matching synthetic name pattern is preserved", () => {
        // Regression: previously the formatter detected synthetic bare-call
        // names by regex `/^_\d+_\d+$/`, which collides with legitimate
        // identifiers. The fix uses an `isSynthetic` flag on the AST node.
        const out = roundTrip(`workflow w(): string {
            const _1_2 = "user";
            return _1_2;
        }`);
        expect(out).toContain('const _1_2 = "user";');
        expect(out).toContain("return _1_2;");
    });

    test("switch default-first ordering preserved", () => {
        const src = `workflow w(x: string): string {
            switch (x) {
                default: return "d";
                case "a": return "a";
            }
        }`;
        const out = roundTrip(src);
        const defaultPos = out.indexOf("default:");
        const casePos = out.indexOf('case "a"');
        expect(defaultPos).toBeGreaterThan(-1);
        expect(casePos).toBeGreaterThan(-1);
        expect(defaultPos).toBeLessThan(casePos);
        assertStable(src);
    });

    test("switch default-middle ordering preserved", () => {
        const src = `workflow w(x: string): string {
            switch (x) {
                case "a": return "a";
                default: return "d";
                case "b": return "b";
            }
        }`;
        const out = roundTrip(src);
        const posA = out.indexOf('case "a"');
        const posDef = out.indexOf("default:");
        const posB = out.indexOf('case "b"');
        expect(posA).toBeLessThan(posDef);
        expect(posDef).toBeLessThan(posB);
        assertStable(src);
    });

    test("bare task call (synthetic const) re-emits as expression statement", () => {
        const src = `workflow w(d: string): string {
            audit.log(d);
            return "ok";
        }`;
        const out = roundTrip(src);
        expect(out).toContain("audit.log(d);");
        expect(out).not.toMatch(/const _\d+_\d+/);
    });

    test("string escaping", () => {
        const wf = parse(`workflow w(): string { return "a\\"b\\nc"; }`);
        const out = format(wf);
        expect(out).toContain(`"a\\"b\\nc"`);
    });
});

describe("formatter: options", () => {
    test("indent option respected", () => {
        const out = format(parse(`workflow w(): string { return "x"; }`), {
            indent: 2,
        });
        expect(out).toMatch(/^  return "x";/m);
    });

    test("eol option respected", () => {
        const out = format(parse(`workflow w(): string { return "x"; }`), {
            eol: "\r\n",
        });
        expect(out).toContain("\r\n");
    });
});

describe("formatter: expression edge cases", () => {
    test("nested ternary round-trips and re-parses to same shape", () => {
        const src = `workflow w(a: boolean, b: boolean, c: boolean): string {
            return a ? (b ? "x" : "y") : (c ? "z" : "w");
        }`;
        // Stability is sufficient evidence the second parse produces the
        // same canonical form; the ternary is right-associative so the
        // formatter is permitted to drop the redundant parens.
        const out = assertStable(src);
        expect(out).toContain("a ? ");
        expect(out).toContain('"x"');
        expect(out).toContain('"w"');
    });

    test("non-commutative '-' is left-associative without parens", () => {
        const src = `workflow w(): number { return 10 - 3 - 2; }`;
        const out = assertStable(src);
        // No spurious parens around the left chain.
        expect(out).toContain("return 10 - 3 - 2;");
    });

    test("non-commutative '-' preserves parens on the right operand", () => {
        // 10 - (3 - 2) = 9 must NOT be flattened to 10 - 3 - 2 = 5.
        const src = `workflow w(): number { return 10 - (3 - 2); }`;
        const out = assertStable(src);
        expect(out).toContain("10 - (3 - 2)");
    });

    test("non-commutative '/' preserves grouping", () => {
        const left = assertStable(
            `workflow w(): number { return 10 / 2 / 5; }`,
        );
        expect(left).toContain("return 10 / 2 / 5;");
        const right = assertStable(
            `workflow w(): number { return 10 / (2 / 5); }`,
        );
        expect(right).toContain("10 / (2 / 5)");
    });

    test("'%' preserves grouping on the right operand", () => {
        const out = assertStable(
            `workflow w(): number { return 10 % (3 % 2); }`,
        );
        expect(out).toContain("10 % (3 % 2)");
    });

    test("unary minus on identifier", () => {
        const out = assertStable(
            `workflow w(a: number): number { return -a; }`,
        );
        expect(out).toContain("return -a;");
    });

    test("unary minus on parenthesized expression keeps parens", () => {
        const out = assertStable(
            `workflow w(a: number, b: number): number { return -(a + b); }`,
        );
        expect(out).toContain("-(a + b)");
    });

    test("builtin nested inside builtin round-trips", () => {
        const src = `workflow w(items: number[]): number[] {
            const r = map(filter(items, (x) => { return x; }), (y) => { return y; });
            return r;
        }`;
        const out = assertStable(src);
        // Outer map and inner filter both present and properly nested.
        expect(out).toContain("map(filter(items, (x) =>");
    });
});

describe("formatter: comment attachment edge cases (G8)", () => {
    test("comment before 'else' is preserved (attached inside else block)", () => {
        // Implementation detail: the parser attaches the trivia before
        // `else` as a leading comment of the first statement of the
        // else-branch. This test pins down current behaviour so any
        // future move (e.g. attaching as trailing comment of the then
        // branch) is a deliberate change rather than silent comment loss.
        const src = `workflow w(a: boolean): string {
            if (a) {
                return "x";
            }
            /* before-else */
            else {
                return "y";
            }
        }`;
        const out = roundTrip(src);
        expect(out).toContain("/* before-else */");
    });

    test("comment before 'case' arm is preserved", () => {
        const src = `workflow w(a: string): string {
            switch (a) {
                case "x":
                    return "x";
                /* note */
                case "y":
                    return "y";
            }
        }`;
        const out = roundTrip(src);
        expect(out).toContain("/* note */");
    });

    test("multi-line block comment is preserved verbatim", () => {
        const src = `/*
 * banner
 * line2
 */
workflow w(): string { return "x"; }`;
        const out = roundTrip(src);
        expect(out).toContain("* banner");
        expect(out).toContain("* line2");
    });
});

describe("formatter: raw literal round-trip (A2)", () => {
    test("preserves all escape kinds in double-quoted strings", () => {
        // Source has the 6 char sequence: \\ \n \t \r \" inside "..."
        const src = 'workflow w(): string { return "a\\\\b\\nc\\td\\re\\"f"; }';
        const out = assertStable(src);
        expect(out).toContain('"a\\\\b\\nc\\td\\re\\"f"');
    });

    test("preserves escapes in single-quoted strings", () => {
        const src = "workflow w(): string { return 'a\\\\b\\nc\\'d'; }";
        const out = assertStable(src);
        expect(out).toContain("'a\\\\b\\nc\\'d'");
    });

    test("preserves \\${ and backtick escapes in NoSub templates", () => {
        // Source: workflow w(): string { return `\${not} and \` end`; }
        const src = "workflow w(): string { return `\\${not} and \\` end`; }";
        const out = assertStable(src);
        expect(out).toContain("\\${not}");
        expect(out).toContain("\\`");
    });

    test("preserves \\${ inside interpolated template", () => {
        // Source: workflow w(x: string): string { return `pre\${nope}${x}post`; }
        const src =
            "workflow w(x: string): string { return `pre\\${nope}${x}post`; }";
        const out = assertStable(src);
        expect(out).toContain("\\${nope}");
        expect(out).toContain("${x}");
    });

    test("preserves empty string and empty template", () => {
        const src =
            'workflow w(): string { const a = ""; const b = ``; return a; }';
        const out = assertStable(src);
        expect(out).toContain('""');
        expect(out).toContain("``");
    });

    test("trailing backslash inside a string is reported as a parse error", () => {
        // Source: workflow w(): string { return "\"; }
        // (a lone backslash before the closing quote)
        const source = 'workflow w(): string { return "\\"; }';
        const { tokens, errors: lexErrors, comments } = lex(source);
        if (lexErrors.length > 0) {
            // Lexer caught it - acceptable.
            return;
        }
        const { errors } = new Parser(tokens, comments).parseSingle();
        const hasBackslashErr = errors.some((e) =>
            /backslash/i.test(e.message),
        );
        expect(hasBackslashErr).toBe(true);
    });
});

describe("compiler: comments don't perturb IR", () => {
    test("source with comments yields identical IR to comment-free source", () => {
        const bare = `workflow w(a: string): string {
            const x = a;
            return x;
        }`;
        const commented = `// header
workflow w(a: string): string {
    /* before const */
    const x = a; // trailing on const line
    // before return
    return x;
}`;
        const r1 = compile(bare, []);
        const r2 = compile(commented, []);
        expect(r1.errors).toEqual([]);
        expect(r2.errors).toEqual([]);
        expect(r2.ir).toEqual(r1.ir);
    });
});
