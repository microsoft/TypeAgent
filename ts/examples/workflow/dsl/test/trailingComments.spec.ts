// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Trailing-comment support tests.
 *
 * Covers the trailing/inner comment extension to G8: comments that
 * appear after a statement on the same physical line (inline trailing),
 * comments that appear at the end of a block (attached as trailing on
 * the last statement), and comments inside an otherwise empty block
 * (attached as `innerComments` on the workflow).
 */

import { lex } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { format } from "../src/formatter.js";
import { compile } from "../src/compiler.js";
import { WorkflowDecl, IfStatement, SwitchStatement } from "../src/ast.js";

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

function assertStable(source: string): string {
    const once = roundTrip(source);
    const twice = format(parse(once));
    expect(twice).toBe(once);
    return once;
}

describe("parser: trailing comments", () => {
    test("inline trailing comment attaches to const", () => {
        const wf = parse(`workflow w(): string {
    const x = "y"; // explain x
    return x;
}`);
        const s0 = wf.body[0];
        expect(s0.trailingComments).toHaveLength(1);
        expect(s0.trailingComments![0].text).toBe("// explain x");
        expect(s0.endLine).toBe(2);
        // The next statement should NOT have a leading comment for the
        // inline trailing one.
        expect(wf.body[1].leadingComments).toBeUndefined();
    });

    test("inline trailing on return", () => {
        const wf = parse(`workflow w(): string {
    return "x"; /* done */
}`);
        const s0 = wf.body[0];
        expect(s0.trailingComments).toHaveLength(1);
        expect(s0.trailingComments![0].text).toBe("/* done */");
    });

    test("inline trailing on break inside switch", () => {
        const wf = parse(`workflow w(x: number): string {
    switch (x) {
        case 1:
            break; // exit
        default:
            return "d";
    }
    return "x";
}`);
        const sw = wf.body[0] as SwitchStatement;
        const brk = sw.arms[0].body[0];
        expect(brk.kind).toBe("BreakStatement");
        expect(brk.trailingComments).toHaveLength(1);
        expect(brk.trailingComments![0].text).toBe("// exit");
    });

    test("inline trailing on throw", () => {
        const wf = parse(`workflow w(): string {
    throw "bad"; // boom
}`);
        const s0 = wf.body[0];
        expect(s0.trailingComments).toHaveLength(1);
    });

    test("inline trailing on if (after closing brace)", () => {
        const wf = parse(`workflow w(x: number): string {
    if (x === 1) {
        return "y";
    } // done
    return "n";
}`);
        const ifs = wf.body[0] as IfStatement;
        expect(ifs.kind).toBe("IfStatement");
        expect(ifs.trailingComments).toHaveLength(1);
        expect(ifs.trailingComments![0].text).toBe("// done");
    });

    test("trailing comment at end of workflow body attaches to last stmt", () => {
        const wf = parse(`workflow w(): string {
    return "x";
    // closing note
}`);
        const s0 = wf.body[0];
        expect(s0.trailingComments).toHaveLength(1);
        expect(s0.trailingComments![0].text).toBe("// closing note");
        // It should NOT be a workflow-level innerComment.
        expect(wf.innerComments).toBeUndefined();
    });

    test("multiple trailing comments at block end", () => {
        const wf = parse(`workflow w(): string {
    return "x";
    // note one
    /* note two */
}`);
        const s0 = wf.body[0];
        expect(s0.trailingComments).toHaveLength(2);
        expect(s0.trailingComments![0].text).toBe("// note one");
        expect(s0.trailingComments![1].text).toBe("/* note two */");
    });

    test("trailing comment in switch arm attaches to last stmt of arm, not next case", () => {
        const wf = parse(`workflow w(x: number): string {
    switch (x) {
        case 1:
            return "a";
        // tail of arm 1
        case 2:
            return "b";
    }
    return "x";
}`);
        const sw = wf.body[0] as SwitchStatement;
        const arm1Last = sw.arms[0].body[0];
        expect(arm1Last.trailingComments).toHaveLength(1);
        expect(arm1Last.trailingComments![0].text).toBe("// tail of arm 1");
        // case 2 (its first stmt) must NOT receive that comment.
        const case2First = sw.arms[1].body[0];
        expect(case2First.leadingComments).toBeUndefined();
    });

    test("inner comments on empty workflow body", () => {
        const wf = parse(`workflow w(): string {
    // only a comment
}`);
        expect(wf.body).toHaveLength(0);
        expect(wf.innerComments).toHaveLength(1);
        expect(wf.innerComments![0].text).toBe("// only a comment");
    });

    test("comment before next statement remains a leading comment, not trailing", () => {
        const wf = parse(`workflow w(): string {
    const x = "y";
    // about return
    return x;
}`);
        const s0 = wf.body[0];
        const s1 = wf.body[1];
        expect(s0.trailingComments).toBeUndefined();
        expect(s1.leadingComments).toHaveLength(1);
        expect(s1.leadingComments![0].text).toBe("// about return");
    });
});

describe("formatter: emits trailing and inner comments", () => {
    test("inline trailing rendered on same line", () => {
        const out = roundTrip(`workflow w(): string {
    const x = "y"; // explain
    return x;
}`);
        expect(out).toContain(`const x = "y"; // explain`);
    });

    test("block-end trailing rendered on its own line after the statement", () => {
        const out = roundTrip(`workflow w(): string {
    return "x";
    // tail
}`);
        // The comment should appear after the return and inside the body.
        expect(out).toMatch(/return "x";\n\s+\/\/ tail\n\}/);
    });

    test("inner comments on empty workflow body rendered inside the braces", () => {
        const out = roundTrip(`workflow w(): string {
    // only a comment
}`);
        expect(out).toMatch(/\{\n\s+\/\/ only a comment\n\}/);
    });

    test("trailing comment on if closing brace is emitted inline", () => {
        const out = roundTrip(`workflow w(x: number): string {
    if (x === 1) {
        return "y";
    } // done
    return "n";
}`);
        expect(out).toMatch(/\} \/\/ done/);
    });

    test("multiple inline trailing comments are space-separated", () => {
        const wf = parse(`workflow w(): string {
    const x = "y"; /* a */ /* b */
    return x;
}`);
        const out = format(wf);
        expect(out).toContain(`const x = "y"; /* a */ /* b */`);
    });

    test("block comment inside trailing-after position renders correctly", () => {
        const out = roundTrip(`workflow w(): string {
    return "x";
    /* tail block */
}`);
        expect(out).toMatch(/return "x";\n\s+\/\* tail block \*\/\n\}/);
    });
});

describe("formatter: stability with trailing comments", () => {
    test("inline trailing is stable", () => {
        assertStable(`workflow w(): string {
    const x = "y"; // explain
    return x;
}`);
    });

    test("block-end trailing is stable", () => {
        assertStable(`workflow w(): string {
    return "x";
    // tail
}`);
    });

    test("inner comments are stable", () => {
        assertStable(`workflow w(): string {
    // only a comment
}`);
    });

    test("switch arm trailing is stable", () => {
        assertStable(`workflow w(x: number): string {
    switch (x) {
        case 1:
            return "a";
        // tail of arm 1
        case 2:
            return "b";
    }
    return "x";
}`);
    });

    test("if with inline-after-brace trailing is stable", () => {
        assertStable(`workflow w(x: number): string {
    if (x === 1) {
        return "y";
    } // done
    return "n";
}`);
    });

    test("mixed leading + trailing comments are stable", () => {
        assertStable(`workflow w(): string {
    // before
    const x = "y"; // inline
    // between
    return x;
    // after
}`);
    });
});

describe("compiler/IR: trailing/inner comments don't leak", () => {
    test("compile() ignores trailing comments and yields same IR as no-comment version", () => {
        const bareSrc = `workflow w(a: string): string {
    const x = a;
    return x;
}`;
        const commentedSrc = `workflow w(a: string): string {
    const x = a; // inline
    // tail
    return x;
    // after
}`;
        const bare = compile(bareSrc, []);
        const commented = compile(commentedSrc, []);
        expect(bare.errors).toEqual([]);
        expect(commented.errors).toEqual([]);
        expect(commented.ir).toEqual(bare.ir);
    });

    test("compile() IR JSON contains no trailingComments or innerComments", () => {
        const src = `workflow w(): string {
    const x = "y"; // inline
    return x;
    // tail
}`;
        const result = compile(src, []);
        const json = JSON.stringify(result.ir);
        expect(json).not.toContain("trailingComments");
        expect(json).not.toContain("innerComments");
        expect(json).not.toContain("// inline");
        expect(json).not.toContain("// tail");
    });
});

describe("documented gap: comments inside empty nested blocks are dropped", () => {
    // These tests pin the intentional behavior documented in
    // implementation-decision.md §D7 and g8-test-gaps-unaddressed.md
    // "Round 2 — Comments inside empty nested blocks".
    //
    // innerComments only exist on WorkflowDecl. Empty if/else/switch
    // arm bodies have no innerComments slot and their contents become
    // unattached after parse; round-trip loses the comment.

    test("comment inside empty 'then' block is lost on round-trip", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        // TODO: handle case 1
    }
    return "x";
}`;
        const out = roundTrip(src);
        // Pin the (lossy) behavior so we notice if it ever changes:
        expect(out).not.toContain("TODO: handle case 1");
    });

    test("comment inside empty 'else' block is lost on round-trip", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        return "y";
    } else {
        // TODO: not yet
    }
    return "x";
}`;
        const out = roundTrip(src);
        expect(out).not.toContain("TODO: not yet");
    });

    test("comment inside empty switch case arm is lost on round-trip", () => {
        const src = `workflow w(x: number): string {
    switch (x) {
        case 1:
            // TODO: arm 1
        default:
            return "d";
    }
    return "x";
}`;
        // Note: 'case 1' with no statements then 'default' — the parser
        // accepts this; the comment is unattached.
        const out = roundTrip(src);
        expect(out).not.toContain("TODO: arm 1");
    });
});
