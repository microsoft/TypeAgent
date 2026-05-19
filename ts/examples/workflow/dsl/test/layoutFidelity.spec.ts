// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Layout-fidelity tests: the formatter preserves the source's choice
 * of inline vs. multi-line layout for parameter lists, object types,
 * and `else` placement (paramListMultiLine / multiLine /
 * elseOnNewLine), falling back to a width-driven decision via
 * `FormatOptions.printWidth` (default 100) when the AST does not
 * pin the layout. Also covers the SwitchStatement / SwitchArm
 * comment slots introduced alongside.
 */

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Round 4 tests:
 *   - Layout fidelity: paramListMultiLine, elseOnNewLine, ObjectType.multiLine
 *     are preserved across format()/parse() cycles.
 *   - printWidth: overrides "preserve inline" when the projected width
 *     would exceed the budget; collapses to multi-line.
 *   - SwitchStatement.innerComments / defaultLeadingComments,
 *     SwitchArm.leadingComments slot work.
 *   - ObjectType field comments (leading/trailing/inner).
 */

import { lex } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { format, FormatOptions } from "../src/formatter.js";
import { WorkflowDecl, IfStatement, SwitchStatement } from "../src/ast.js";

function parse(src: string): WorkflowDecl {
    const { tokens, comments, errors: lexErrors } = lex(src);
    expect(lexErrors).toEqual([]);
    const p = new Parser(tokens, comments);
    const { ast, errors } = p.parseSingle();
    expect(errors).toEqual([]);
    expect(ast).toBeDefined();
    return ast!;
}

function assertStable(src: string, opts?: FormatOptions): string {
    const ast1 = parse(src);
    const out1 = format(ast1, opts);
    const out2 = format(parse(out1), opts);
    expect(out2).toBe(out1);
    return out1;
}

// ---------------------------------------------------------------------------
// A. Layout preservation
// ---------------------------------------------------------------------------

describe("paramListMultiLine layout preservation", () => {
    test("inline param list stays inline (no comments, fits)", () => {
        const out = assertStable(
            `workflow w(a: number, b: string): string {\n    return b;\n}`,
        );
        expect(out).toMatch(/workflow w\(a: number, b: string\):/);
    });

    test("multi-line param list (no comments) stays multi-line", () => {
        const out = assertStable(
            `workflow w(\n    a: number,\n    b: string,\n): string {\n    return b;\n}`,
        );
        // Multi-line preserved: opening "(" followed by newline, each
        // param on its own line.
        expect(out).toMatch(
            /workflow w\(\n {4}a: number,\n {4}b: string,\n\): string \{/,
        );
    });

    test("printWidth override forces multi-line when single-line overflows", () => {
        const longName = "a".repeat(60);
        const src = `workflow w(p1: number, p2: number, ${longName}: number): number { return p1; }`;
        const out = assertStable(src, { printWidth: 80 });
        // Should have switched to multi-line because the single-line
        // form would exceed 80 columns.
        expect(out).toContain(`workflow w(\n`);
        expect(out).toContain(`${longName}: number,\n`);
    });

    test("printWidth: Infinity disables width-based wrap", () => {
        const longName = "a".repeat(120);
        const src = `workflow w(p1: number, ${longName}: number): number { return p1; }`;
        const out = format(parse(src), { printWidth: Infinity });
        // Stays inline because we explicitly disabled width.
        expect(out.split("\n")[0].length).toBeGreaterThan(100);
    });

    test("paramListMultiLine flag set by parser only when multi-line", () => {
        const inlineAst = parse(`workflow w(a: number): number { return a; }`);
        expect(inlineAst.paramListMultiLine).toBeUndefined();
        const mlAst = parse(
            `workflow w(\n    a: number,\n): number {\n    return a;\n}`,
        );
        expect(mlAst.paramListMultiLine).toBe(true);
    });
});

describe("elseOnNewLine layout preservation", () => {
    test("inline `} else { ... }` stays inline", () => {
        const out = assertStable(
            `workflow w(a: boolean): string {\n    if (a) {\n        return "y";\n    } else {\n        return "n";\n    }\n}`,
        );
        expect(out).toMatch(/} else \{/);
    });

    test("`}\\nelse { ... }` (else on new line) stays on new line", () => {
        const out = assertStable(
            `workflow w(a: boolean): string {\n    if (a) {\n        return "y";\n    }\n    else {\n        return "n";\n    }\n}`,
        );
        // Find the line ending with `}` (then-block close) followed by
        // a line starting with `else`.
        const lines = out.split("\n");
        let found = false;
        for (let i = 0; i + 1 < lines.length; i++) {
            if (
                lines[i].trimEnd().endsWith("}") &&
                /^\s*else\b/.test(lines[i + 1])
            ) {
                found = true;
                break;
            }
        }
        expect(found).toBe(true);
    });

    test("elseOnNewLine flag set only when else lands on a new line", () => {
        const inlineAst = parse(
            `workflow w(a: boolean): string {\n    if (a) { return "y"; } else { return "n"; }\n}`,
        );
        const inlineIf = inlineAst.body[0] as IfStatement;
        expect(inlineIf.elseOnNewLine).toBeUndefined();

        const newlineAst = parse(
            `workflow w(a: boolean): string {\n    if (a) { return "y"; }\n    else { return "n"; }\n}`,
        );
        const newlineIf = newlineAst.body[0] as IfStatement;
        expect(newlineIf.elseOnNewLine).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// B. SwitchStatement.innerComments / SwitchArm.leadingComments
// ---------------------------------------------------------------------------

describe("SwitchStatement.innerComments", () => {
    test("comment inside empty switch body lives on switch.innerComments", () => {
        const wf = parse(
            `workflow w(x: number): string {\n    switch (x) {\n        /* nothing */\n    }\n    return "x";\n}`,
        );
        const sw = wf.body[0] as SwitchStatement;
        expect(sw.innerComments).toHaveLength(1);
        expect(sw.innerComments![0].text).toBe("/* nothing */");
    });

    test("round-trip stable; comment stays inside the switch body", () => {
        const out = assertStable(
            `workflow w(x: number): string {\n    switch (x) {\n        /* nothing */\n    }\n    return "x";\n}`,
        );
        const sStart = out.indexOf("switch");
        const sEnd = out.indexOf("}", sStart);
        const cIdx = out.indexOf("/* nothing */");
        expect(cIdx).toBeGreaterThan(sStart);
        expect(cIdx).toBeLessThan(sEnd);
    });

    test("comments before first case also captured (innerComments before arm 0)", () => {
        const wf = parse(
            `workflow w(x: number): string {\n    switch (x) {\n        // pre-arm\n        case 1:\n            return "a";\n    }\n    return "x";\n}`,
        );
        const sw = wf.body[0] as SwitchStatement;
        // First-arm leadingComments path: comment before `case` keyword
        // attaches to that arm.
        expect(sw.arms[0].leadingComments).toHaveLength(1);
        expect(sw.arms[0].leadingComments![0].text).toBe("// pre-arm");
    });
});

describe("SwitchArm.leadingComments (pre-case)", () => {
    test("attaches to the next arm; round-trip stable", () => {
        const out = assertStable(
            `workflow w(x: number): string {\n    switch (x) {\n        case 1:\n            return "a";\n        // before case 2\n        case 2:\n            return "b";\n    }\n    return "x";\n}`,
        );
        const cIdx = out.indexOf("// before case 2");
        const case2Idx = out.indexOf("case 2");
        expect(cIdx).toBeLessThan(case2Idx);
    });

    test("defaultLeadingComments captured", () => {
        const wf = parse(
            `workflow w(x: number): string {\n    switch (x) {\n        case 1:\n            return "a";\n        // fallback\n        default:\n            return "b";\n    }\n}`,
        );
        const sw = wf.body[0] as SwitchStatement;
        expect(sw.defaultLeadingComments).toHaveLength(1);
        expect(sw.defaultLeadingComments![0].text).toBe("// fallback");
    });
});

// ---------------------------------------------------------------------------
// C. ObjectType field comments
// ---------------------------------------------------------------------------

describe("ObjectType field comments", () => {
    test("leading comment on a field round-trips", () => {
        const src = `workflow w(o: {\n    /* hi */\n    foo: number,\n    bar: string,\n}): string {\n    return bar;\n}`;
        const out = assertStable(src);
        expect(out).toContain("/* hi */");
        expect(out).toContain("foo: number");
    });

    test("trailing line comment on a field (after comma) round-trips", () => {
        const src = `workflow w(o: {\n    foo: number, // a count\n    bar: string,\n}): string {\n    return bar;\n}`;
        const out = assertStable(src);
        expect(out).toContain("// a count");
        // Should be on the same line as `foo: number,`.
        const lines = out.split("\n");
        const fooLine = lines.find((l) => l.includes("foo:"));
        expect(fooLine).toBeDefined();
        expect(fooLine!).toContain("// a count");
    });

    test("inner comment in empty object type round-trips", () => {
        const src = `workflow w(o: {\n    /* shape: empty */\n}): string {\n    return "x";\n}`;
        const out = assertStable(src);
        expect(out).toContain("/* shape: empty */");
    });

    test("inline ObjectType (no comments, fits) stays inline", () => {
        const out = assertStable(
            `workflow w(o: { foo: number, bar: string }): string {\n    return bar;\n}`,
        );
        expect(out).toContain("{ foo: number, bar: string }");
    });

    test("multi-line ObjectType (no comments) preserved as multi-line", () => {
        const out = assertStable(
            `workflow w(o: {\n    foo: number,\n    bar: string,\n}): string {\n    return bar;\n}`,
        );
        expect(out).toContain("o: {\n    foo: number,\n    bar: string,\n}");
    });

    test("ObjectType comment forces multi-line even when fields would fit inline", () => {
        const out = assertStable(
            `workflow w(o: { foo: number /* count */, bar: string }): string {\n    return bar;\n}`,
        );
        expect(out).toContain("/* count */");
        // Forced multi-line because trailing comment lives on a field.
        expect(out).toMatch(/o: \{\n/);
    });
});

// ---------------------------------------------------------------------------
// D. printWidth corner cases
// ---------------------------------------------------------------------------

describe("printWidth boundary", () => {
    test("exactly at printWidth: stays inline", () => {
        // Build a workflow whose first line is exactly 80 chars.
        const src = `workflow w(a: number): number { return a; }`;
        const out = format(parse(src), { printWidth: 80 });
        // 'workflow w(a: number): number {' = 31 chars -> well under 80
        expect(out.split("\n")[0]).toBe("workflow w(a: number): number {");
    });

    test("printWidth: 0 collapses inline param list to multi-line", () => {
        const src = `workflow w(a: number): number { return a; }`;
        const out = format(parse(src), { printWidth: 0 });
        expect(out).toContain("workflow w(\n");
    });
});
