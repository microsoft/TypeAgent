// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Trailing-comment support tests.
 *
 * Covers the trailing/inner comment extension: comments that
 * appear after a statement on the same physical line (inline trailing),
 * comments that appear at the end of a block (attached as trailing on
 * the last statement), and comments inside an otherwise empty block
 * (attached as `innerComments` on the workflow).
 */

import { lex } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { format } from "./_testUtil.js";
import { compile } from "../src/compiler.js";
import { extractGraph } from "../src/graphExtractor.js";
import {
    WorkflowDecl,
    IfStatement,
    SwitchStatement,
    DestructuringConst,
    ConstStatement,
} from "../src/ast.js";

function parse(source: string): WorkflowDecl {
    const { tokens, errors: lexErrors, comments } = lex(source);
    expect(lexErrors).toEqual([]);
    const parser = new Parser(tokens, comments);
    const { module: __m, errors } = parser.parseModule();
    const ast = __m.workflows[0];
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

    test("comment between two `case` arms attaches as the next arm's leading", () => {
        const wf = parse(`workflow w(x: number): string {
    switch (x) {
        case 1:
            return "a";
        // before case 2
        case 2:
            return "b";
    }
    return "x";
}`);
        const sw = wf.body[0] as SwitchStatement;
        const arm1Last = sw.arms[0].body[0];
        // The comment is closer to `case 2` than to arm 1's body, so by
        // round-3 round 4 convention it lives on arm 2's leadingComments
        // (matching the TS convention and giving the comment a
        // semantically-meaningful slot).
        expect(arm1Last.trailingComments).toBeUndefined();
        expect(sw.arms[1].leadingComments).toHaveLength(1);
        expect(sw.arms[1].leadingComments![0].text).toBe("// before case 2");
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

describe("comments inside empty nested blocks are preserved", () => {
    // These were previously documented as a "gap" (see formatter-design.md
    // §D7 — superseded in round 3). The parser now captures *innerComments
    // on every block-bearing AST node, not just WorkflowDecl, and the
    // formatter emits them inside the empty `{ }`.

    test("comment inside empty 'then' block round-trips", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        // TODO: handle case 1
    }
    return "x";
}`;
        const out = roundTrip(src);
        expect(out).toContain("// TODO: handle case 1");
        assertStable(src);
    });

    test("comment inside empty 'else' block round-trips", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        return "y";
    } else {
        // TODO: not yet
    }
    return "x";
}`;
        const out = roundTrip(src);
        expect(out).toContain("// TODO: not yet");
        assertStable(src);
    });

    test("comment inside empty switch case arm round-trips", () => {
        const src = `workflow w(x: number): string {
    switch (x) {
        case 1:
            // TODO: arm 1
        default:
            return "d";
    }
    return "x";
}`;
        const out = roundTrip(src);
        expect(out).toContain("// TODO: arm 1");
        assertStable(src);
    });

    test("comment inside empty 'default' arm round-trips", () => {
        const src = `workflow w(x: number): string {
    switch (x) {
        case 1:
            return "a";
        default:
            // fallthrough handled upstream
    }
    return "x";
}`;
        const out = roundTrip(src);
        expect(out).toContain("// fallthrough handled upstream");
        assertStable(src);
    });

    test("comment inside empty workflow with empty if/else round-trips", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        /* maybe later */
    } else {
        /* also maybe later */
    }
    return "x";
}`;
        const out = roundTrip(src);
        expect(out).toContain("/* maybe later */");
        expect(out).toContain("/* also maybe later */");
        assertStable(src);
    });

    test("comment inside empty attempts body round-trips", () => {
        const src = `workflow w(): string {
    const x = attempts(3, () => {
        // retry me
    });
    return "ok";
}`;
        const out = roundTrip(src);
        expect(out).toContain("// retry me");
        assertStable(src);
    });

    test("comment inside empty map body round-trips", () => {
        const src = `workflow w(xs: string[]): string[] {
    return map(xs, (item) => {
        // map me
    });
}`;
        const out = roundTrip(src);
        expect(out).toContain("// map me");
        assertStable(src);
    });

    test("comment inside empty parallel branch round-trips", () => {
        const src = `workflow w(): string {
    const x = parallel(() => {
        // branch 1
    }, () => {
        // branch 2
    });
    return "ok";
}`;
        const out = roundTrip(src);
        expect(out).toContain("// branch 1");
        expect(out).toContain("// branch 2");
        assertStable(src);
    });
});

describe("comment between } and else", () => {
    test("inline block comment between } and else round-trips", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        return "a";
    } /* note */ else {
        return "b";
    }
}`;
        const out = roundTrip(src);
        expect(out).toContain("/* note */");
        assertStable(src);
    });

    test("line comment between } and else forces newline", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        return "a";
    } // note
    else {
        return "b";
    }
}`;
        const out = roundTrip(src);
        expect(out).toContain("// note");
        // After the line comment, "else" must be on its own line (not after //).
        const lines = out.split("\n");
        const elseLine = lines.find((l) => l.trim().startsWith("else"));
        expect(elseLine).toBeDefined();
        assertStable(out);
    });

    test("comment between } and else-if round-trips", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        return "a";
    } /* fallthrough */ else if (x === 2) {
        return "b";
    } else {
        return "c";
    }
}`;
        const out = roundTrip(src);
        expect(out).toContain("/* fallthrough */");
        assertStable(src);
    });
});

describe("comments around parameters", () => {
    test("leading comment on parameter round-trips", () => {
        const src = `workflow w(
    // the first one
    a: number,
    b: string,
): string {
    return b;
}`;
        const out = roundTrip(src);
        expect(out).toContain("// the first one");
        assertStable(out);
    });

    test("inline trailing comment on parameter round-trips", () => {
        const src = `workflow w(
    a: number, // count
    b: string, // label
): string {
    return b;
}`;
        const out = roundTrip(src);
        expect(out).toContain("// count");
        expect(out).toContain("// label");
        assertStable(out);
    });

    test("comment in empty parameter list round-trips", () => {
        const src = `workflow w(
    // no params yet
): string {
    return "x";
}`;
        const out = roundTrip(src);
        expect(out).toContain("// no params yet");
        assertStable(out);
    });

    test("simple parameter list without comments stays inline", () => {
        const src = `workflow w(a: number, b: string): string {
    return b;
}`;
        const out = roundTrip(src);
        expect(out).toContain("workflow w(a: number, b: string)");
    });

    test("mixed param comments preserve order", () => {
        const src = `workflow w(
    /* leading-a */
    a: number, // trail-a
    // leading-b
    b: string,
): string {
    return b;
}`;
        const out = roundTrip(src);
        expect(out).toContain("/* leading-a */");
        expect(out).toContain("// trail-a");
        expect(out).toContain("// leading-b");
        assertStable(out);
    });
});

describe("parser: trailing comments on additional statement kinds", () => {
    test("inline trailing on DestructuringConst", () => {
        const wf = parse(`workflow w(): string {
    const [a, b] = text.split(s: "x", sep: ","); // unpack
    return a;
}`);
        const s0 = wf.body[0] as DestructuringConst;
        expect(s0.kind).toBe("DestructuringConst");
        expect(s0.trailingComments).toHaveLength(1);
        expect(s0.trailingComments![0].text).toBe("// unpack");
        // Round-trip preserves
        const out = format(wf);
        expect(out).toContain(
            `const [a, b] = text.split(s: "x", sep: ","); // unpack`,
        );
        assertStable(`workflow w(): string {
    const [a, b] = text.split(s: "x", sep: ","); // unpack
    return a;
}`);
    });

    test("inline trailing on if-else closing brace", () => {
        const wf = parse(`workflow w(x: number): string {
    if (x === 1) {
        return "y";
    } else {
        return "n";
    } // end of branch
    return "x";
}`);
        const ifs = wf.body[0] as IfStatement;
        expect(ifs.kind).toBe("IfStatement");
        expect(ifs.trailingComments).toHaveLength(1);
        expect(ifs.trailingComments![0].text).toBe("// end of branch");
        const out = format(wf);
        expect(out).toMatch(/\} \/\/ end of branch/);
    });

    test("inline trailing on switch closing brace", () => {
        const wf = parse(`workflow w(x: number): string {
    switch (x) {
        case 1:
            return "a";
        default:
            return "d";
    } // dispatch done
    return "x";
}`);
        const sw = wf.body[0] as SwitchStatement;
        expect(sw.kind).toBe("SwitchStatement");
        expect(sw.trailingComments).toHaveLength(1);
        expect(sw.trailingComments![0].text).toBe("// dispatch done");
    });

    test("trailing on nested if (if inside if)", () => {
        const wf = parse(`workflow w(x: number): string {
    if (x > 0) {
        if (x > 10) {
            return "big";
        } // inner done
        return "small";
    }
    return "neg";
}`);
        const outer = wf.body[0] as IfStatement;
        const inner = outer.then[0] as IfStatement;
        expect(inner.kind).toBe("IfStatement");
        expect(inner.trailingComments).toHaveLength(1);
        expect(inner.trailingComments![0].text).toBe("// inner done");
        // Round-trip and stable
        assertStable(`workflow w(x: number): string {
    if (x > 0) {
        if (x > 10) {
            return "big";
        } // inner done
        return "small";
    }
    return "neg";
}`);
    });

    test("trailing on bare expression statement (synthetic const)", () => {
        const wf = parse(`workflow w(x: string): string {
    audit.log(msg: x); // logged
    return x;
}`);
        const s0 = wf.body[0] as ConstStatement;
        expect(s0.kind).toBe("ConstStatement");
        expect(s0.isSynthetic).toBe(true);
        expect(s0.trailingComments).toHaveLength(1);
        expect(s0.trailingComments![0].text).toBe("// logged");
        // Formatter should render it as a bare expression with inline trailing.
        const out = format(wf);
        expect(out).toContain(`audit.log(msg: x); // logged`);
        assertStable(`workflow w(x: string): string {
    audit.log(msg: x); // logged
    return x;
}`);
    });
});

describe("parser: multi-line statements", () => {
    test("multi-line const value attaches inline trailing to the LAST line", () => {
        // Object literal spread across multiple physical lines; the `;`
        // terminator sits on the last line. The comment must attach as an
        // inline trailing comment because it shares the last token's line.
        const wf = parse(`workflow w(): string {
    const x = {
        a: 1,
        b: 2
    }; // tail
    return "x";
}`);
        const s0 = wf.body[0];
        expect(s0.trailingComments).toHaveLength(1);
        expect(s0.trailingComments![0].text).toBe("// tail");
        // endLine should point at the line of the closing `;`, not the
        // line of `const`.
        expect(s0.endLine).toBe(s0.loc.line + 3);
    });

    test("comment between `=` and value on same line moves to trailing (lossy)", () => {
        // The parser has no AST slot for "expression-internal" comments,
        // so a comment that lives between `=` and the value but on the
        // same physical line as the terminator ends up captured as an
        // inline trailing comment. Pin this behavior so it doesn't
        // silently change.
        const wf = parse(`workflow w(): string {
    const x = /* note */ "y";
    return x;
}`);
        const s0 = wf.body[0];
        expect(s0.trailingComments).toHaveLength(1);
        expect(s0.trailingComments![0].text).toBe("/* note */");
        // Formatter rewrites it at the end of the line (lossy reposition).
        const out = format(wf);
        expect(out).toContain(`const x = "y"; /* note */`);
    });
});

describe("parser: mixed inline-trailing comment forms", () => {
    test("mixed // and /* */ on same statement, in source order", () => {
        const wf = parse(`workflow w(): string {
    const x = "y"; /* a */ // b
    return x;
}`);
        const s0 = wf.body[0];
        expect(s0.trailingComments).toHaveLength(2);
        expect(s0.trailingComments![0].text).toBe("/* a */");
        expect(s0.trailingComments![1].text).toBe("// b");
        const out = format(wf);
        expect(out).toContain(`const x = "y"; /* a */ // b`);
    });

    test("mixed inline trailing then block-end trailing", () => {
        const wf = parse(`workflow w(): string {
    const x = "y"; // inline
    // block-end-1
    /* block-end-2 */
    return x;
}`);
        // The two block-end comments belong as leading comments of the
        // next statement, not as trailing of the const. Pin that.
        const s0 = wf.body[0];
        expect(s0.trailingComments).toHaveLength(1);
        expect(s0.trailingComments![0].text).toBe("// inline");
        const s1 = wf.body[1];
        expect(s1.leadingComments).toHaveLength(2);
    });
});

describe("formatter: trailing-comment edge cases", () => {
    test("block comment spanning multiple lines: parses and round-trips once", () => {
        const src = `workflow w(): string {
    return "x";
    /* line a
       line b */
}`;
        const wf = parse(src);
        const s0 = wf.body[0];
        expect(s0.trailingComments).toHaveLength(1);
        expect(s0.trailingComments![0].text).toContain("line a");
        expect(s0.trailingComments![0].text).toContain("line b");
        const out = format(wf);
        expect(out).toContain("line a");
        expect(out).toContain("line b");
    });

    test("multi-line block comment as block-end trailing is round-trip stable", () => {
        const src = `workflow w(): string {
    return "x";
    /* line a
       line b */
}`;
        assertStable(src);
    });

    test("trailing comment containing special chars (backticks, $, braces)", () => {
        const src = `workflow w(): string {
    const x = "y"; // tricky: \`backtick\` and \${dollar} and { brace }
    return x;
}`;
        const wf = parse(src);
        const s0 = wf.body[0];
        expect(s0.trailingComments).toHaveLength(1);
        const text = s0.trailingComments![0].text;
        expect(text).toContain("`backtick`");
        expect(text).toContain("${dollar}");
        expect(text).toContain("{ brace }");
        const out = format(wf);
        expect(out).toContain("`backtick`");
        expect(out).toContain("${dollar}");
        assertStable(src);
    });
});

describe("formatter: FormatOptions interaction with trailing comments", () => {
    test("indent: 2 honored for own-line block-end trailing", () => {
        const wf = parse(`workflow w(): string {
    return "x";
    // tail
}`);
        const out = format(wf, { indent: 2 });
        // 2-space indent on the body line: "  return", and on the trailing
        // comment line: "  // tail".
        expect(out).toMatch(/^  return "x";$/m);
        expect(out).toMatch(/^  \/\/ tail$/m);
    });

    test("custom eol (CRLF) used for trailing-comment newlines", () => {
        const wf = parse(`workflow w(): string {
    return "x";
    // tail
}`);
        const out = format(wf, { eol: "\r\n" });
        // No bare \n anywhere — every newline must be \r\n.
        expect(
            out
                .split("\n")
                .every((seg, i, arr) =>
                    i === arr.length - 1 ? true : seg.endsWith("\r"),
                ),
        ).toBe(true);
        // The trailing comment line is present.
        expect(out).toContain("// tail");
    });

    test("indent: 2 stable across two formats", () => {
        const src = `workflow w(): string {
    const x = "y"; // inline
    // mid
    return x;
}`;
        const once = format(parse(src), { indent: 2 });
        const twice = format(parse(once), { indent: 2 });
        expect(twice).toBe(once);
    });
});

describe("parser: trailing comments inside built-in node bodies", () => {
    test("inline trailing on last stmt of attempts body", () => {
        const src = `workflow w(): string {
    const r = attempts(3, () => {
        return "ok"; // try
    });
    return r;
}`;
        const wf = parse(src);
        const s0 = wf.body[0] as ConstStatement;
        expect(s0.kind).toBe("ConstStatement");
        const attempts = s0.value;
        expect(attempts.kind).toBe("AttemptsNode");
        const inner = (attempts as { body: any[] }).body[0];
        expect(inner.kind).toBe("ReturnStatement");
        expect(inner.trailingComments).toHaveLength(1);
        expect(inner.trailingComments![0].text).toBe("// try");
        const out = format(wf);
        expect(out).toContain(`return "ok"; // try`);
        assertStable(src);
    });

    test("inline trailing on last stmt of map body", () => {
        const src = `workflow w(items: string[]): string[] {
    const r = map(items, (item) => {
        return item; // each
    });
    return r;
}`;
        const wf = parse(src);
        const out = format(wf);
        expect(out).toContain(`return item; // each`);
        assertStable(src);
    });
});

describe("graphExtractor / visualize: trailing comments are transparent", () => {
    test("extractGraph yields same graph with and without trailing comments", () => {
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
        const bare = extractGraph(parse(bareSrc));
        const commented = extractGraph(parse(commentedSrc));
        // Comments live on AST, not on the graph model; identical nodes/edges.
        expect(commented.nodes.length).toBe(bare.nodes.length);
        expect(commented.edges.length).toBe(bare.edges.length);
        const json = JSON.stringify(commented);
        expect(json).not.toContain("trailingComments");
        expect(json).not.toContain("// inline");
        expect(json).not.toContain("// tail");
    });
});

describe("end-to-end: parse + format succeeds on every new trailing-comment shape", () => {
    test("parse + format + assertStable for each shape", () => {
        const srcs = [
            // if-else trailing
            `workflow w(x: number): string {
    if (x === 1) {
        return "y";
    } else {
        return "n";
    } // end
    return "x";
}`,
            // multi-line const with trailing
            `workflow w(): string {
    const x = {
        a: 1,
        b: 2
    }; // tail
    return "x";
}`,
            // mixed inline trailings
            `workflow w(): string {
    const x = "y"; /* a */ // b
    return x;
}`,
        ];
        for (const src of srcs) {
            assertStable(src);
        }
    });
});

// ---------------------------------------------------------------------------
// Second-pass (post-round-2) gap coverage.
// ---------------------------------------------------------------------------

describe("parser: degenerate comment lexemes", () => {
    test("empty block comment /**/ as inline trailing parses and round-trips", () => {
        const src = `workflow w(): string {
    const x = "y"; /**/
    return x;
}`;
        const wf = parse(src);
        expect(wf.body[0].trailingComments).toHaveLength(1);
        expect(wf.body[0].trailingComments![0].text).toBe("/**/");
        const out = format(wf);
        expect(out).toContain(`const x = "y"; /**/`);
        assertStable(src);
    });

    test("empty line comment // (no content) as inline trailing round-trips", () => {
        const src = `workflow w(): string {
    const x = "y"; //
    return x;
}`;
        const wf = parse(src);
        expect(wf.body[0].trailingComments).toHaveLength(1);
        expect(wf.body[0].trailingComments![0].text).toBe("//");
        assertStable(src);
    });

    test("line comment containing block-comment opener (// /*) is one line comment", () => {
        const src = `workflow w(): string {
    const x = "y"; // /* not a block
    return x;
}`;
        const wf = parse(src);
        const t = wf.body[0].trailingComments;
        expect(t).toHaveLength(1);
        expect(t![0].text).toBe("// /* not a block");
        assertStable(src);
    });

    test("block comment containing line-comment delimiter (/* // */) is one block comment", () => {
        const src = `workflow w(): string {
    const x = "y"; /* // not a line */
    return x;
}`;
        const wf = parse(src);
        const t = wf.body[0].trailingComments;
        expect(t).toHaveLength(1);
        expect(t![0].text).toBe("/* // not a line */");
        assertStable(src);
    });

    test("block comment containing stars (/* * */) preserves text", () => {
        const src = `workflow w(): string {
    const x = "y"; /* * star */
    return x;
}`;
        const wf = parse(src);
        expect(wf.body[0].trailingComments![0].text).toBe("/* * star */");
        assertStable(src);
    });
});

describe("parser: column information for comments", () => {
    test("comment at column 1 preserves pos.col === 1", () => {
        const wf = parse(`workflow w(): string {
// col1-leading
    return "x";
}`);
        const c = wf.body[0].leadingComments;
        expect(c).toHaveLength(1);
        expect(c![0].pos.col).toBe(1);
        expect(c![0].pos.line).toBe(2);
    });

    test("deeply indented comment preserves pos.col matching source indent", () => {
        // The // sits at column 13 (12 spaces + 1, 1-based).
        const src = `workflow w(x: number): string {
    if (x > 0) {
            // deeply indented
        return "y";
    }
    return "n";
}`;
        const wf = parse(src);
        const inner = (wf.body[0] as IfStatement).then[0];
        expect(inner.leadingComments).toHaveLength(1);
        expect(inner.leadingComments![0].pos.col).toBe(13);
    });

    test("inline trailing comment retains its source column (not just line)", () => {
        const wf = parse(`workflow w(): string {
    const x = "y"; // tail
    return x;
}`);
        const c = wf.body[0].trailingComments![0];
        // "    const x = "y"; " is 19 chars; comment starts at col 20.
        expect(c.pos.col).toBe(20);
        expect(c.pos.line).toBe(2);
    });
});

describe("parser: adjacent inline-trailing + leading independence", () => {
    test("prev statement's inline trailing and next statement's leading don't merge", () => {
        const wf = parse(`workflow w(): string {
    const a = "1"; // a-inline
    // b-leading
    const b = a;
    return b;
}`);
        const s0 = wf.body[0];
        const s1 = wf.body[1];
        expect(s0.trailingComments).toHaveLength(1);
        expect(s0.trailingComments![0].text).toBe("// a-inline");
        expect(s1.leadingComments).toHaveLength(1);
        expect(s1.leadingComments![0].text).toBe("// b-leading");
    });

    test("format order: inline-trail line, then leading line, then statement", () => {
        const src = `workflow w(): string {
    const a = "1"; // a-inline
    // b-leading
    const b = a;
    return b;
}`;
        const out = roundTrip(src);
        const iA = out.indexOf("// a-inline");
        const iB = out.indexOf("// b-leading");
        const iConstB = out.indexOf("const b = a");
        expect(iA).toBeGreaterThan(-1);
        expect(iA).toBeLessThan(iB);
        expect(iB).toBeLessThan(iConstB);
        assertStable(src);
    });
});

describe("parser: workflow-with-statements never produces innerComments", () => {
    test("trailing comment after final return attaches as trailing, not inner", () => {
        const wf = parse(`workflow w(): string {
    return "x";
    // closing
}`);
        // The body is non-empty, so innerComments must not be populated;
        // the comment must live on the last statement's trailingComments.
        expect(wf.innerComments).toBeUndefined();
        expect(wf.body[0].trailingComments).toHaveLength(1);
        expect(wf.body[0].trailingComments![0].text).toBe("// closing");
    });
});

describe("parser: multi-workflow (Parser.parse) preserves per-workflow trailing", () => {
    test("two workflows each get their own inline trailing comments", () => {
        const src = `workflow a(): string {
    return "a"; // tail-a
}
workflow b(): string {
    return "b"; // tail-b
}`;
        const { tokens, errors: lexErrors, comments } = lex(src);
        expect(lexErrors).toEqual([]);
        const parser = new Parser(tokens, comments);
        const { module, errors } = parser.parseModule();
        expect(errors).toEqual([]);
        const workflows = module.workflows;
        expect(workflows).toHaveLength(2);
        expect(workflows[0].body[0].trailingComments).toHaveLength(1);
        expect(workflows[0].body[0].trailingComments![0].text).toBe(
            "// tail-a",
        );
        expect(workflows[1].body[0].trailingComments).toHaveLength(1);
        expect(workflows[1].body[0].trailingComments![0].text).toBe(
            "// tail-b",
        );
    });

    test("formatting both workflows and re-parsing preserves their trailing comments", () => {
        const src = `workflow a(): string {
    return "a"; // tail-a
}
workflow b(): string {
    return "b"; // tail-b
}`;
        const { tokens, comments } = lex(src);
        const m = new Parser(tokens, comments).parseModule().module;
        const combined = m.workflows.map((w) => format(w)).join("");
        const { tokens: t2, comments: c2 } = lex(combined);
        const m2 = new Parser(t2, c2).parseModule().module;
        expect(m2.workflows).toHaveLength(2);
        expect(m2.workflows[0].body[0].trailingComments![0].text).toBe(
            "// tail-a",
        );
        expect(m2.workflows[1].body[0].trailingComments![0].text).toBe(
            "// tail-b",
        );
    });
});

describe("formatter: FormatOptions edge cases with comments", () => {
    test("indent: 1 (smallest non-zero) keeps comments correctly indented", () => {
        const src = `workflow w(): string {
    const x = "y"; // inline
    // tail
    return x;
}`;
        const out = format(parse(src), { indent: 1 });
        // body line uses 1 space indent
        expect(out).toMatch(/^ const x = "y"; \/\/ inline$/m);
        expect(out).toMatch(/^ \/\/ tail$/m);
        // Stability with explicit indent option
        const twice = format(parse(out), { indent: 1 });
        expect(twice).toBe(out);
    });

    test("eol: \\r alone (old MacOS) is used uniformly with comments", () => {
        const src = `workflow w(): string {
    const x = "y"; // inline
    // tail
    return x;
}`;
        const out = format(parse(src), { eol: "\r" });
        expect(out).not.toContain("\n");
        expect(out.includes("\r")).toBe(true);
        // Comment text preserved
        expect(out).toContain("// inline");
        expect(out).toContain("// tail");
    });

    test("deeply nested if/else with comments parses and round-trips quickly", () => {
        // Smoke test: nesting depth 20 should be trivial.
        let src = `workflow w(x: number): string {`;
        for (let i = 0; i < 20; i++) {
            src += `\n${"    ".repeat(i + 1)}if (x === ${i}) { // depth ${i}`;
        }
        src += `\n${"    ".repeat(21)}return "deep";`;
        for (let i = 19; i >= 0; i--) {
            src += `\n${"    ".repeat(i + 1)}}`;
        }
        src += `\n}`;
        const t0 = Date.now();
        const wf = parse(src);
        const out = format(wf);
        const elapsed = Date.now() - t0;
        // Generous bound — should be milliseconds, not seconds.
        expect(elapsed).toBeLessThan(2000);
        // Every "// depth N" comment must survive round-trip.
        for (let i = 0; i < 20; i++) {
            expect(out).toContain(`// depth ${i}`);
        }
        // Stability
        const twice = format(parse(out));
        expect(twice).toBe(out);
    });
});

describe("formatter: pathological volumes", () => {
    test("1000 inline trailing comments on one statement parses and round-trips", () => {
        let inlines = "";
        for (let i = 0; i < 1000; i++) inlines += `/* ${i} */ `;
        const src = `workflow w(): string {\n    const x = "y"; ${inlines}\n    return x;\n}`;
        const t0 = Date.now();
        const wf = parse(src);
        const out = format(wf);
        const elapsed = Date.now() - t0;
        expect(wf.body[0].trailingComments).toHaveLength(1000);
        // Sample preservation
        expect(out).toContain("/* 0 */");
        expect(out).toContain("/* 999 */");
        // Should be fast (parser/formatter are linear in token count).
        expect(elapsed).toBeLessThan(2000);
        // Stable on re-format.
        const twice = format(parse(out));
        expect(twice).toBe(out);
    });
});

describe("formatter: property test — union of leading + trailing + inner", () => {
    test("source with all three comment kinds is round-trip stable across 3 passes", () => {
        const src = `// header
workflow w(a: string): string {
    // leading-a2
    const a2 = a; // inline-a2
    /* between block */
    const b = a2; // inline-b
    // before return
    return b;
    // tail-1
    /* tail-2 */
}`;
        const out1 = roundTrip(src);
        const out2 = roundTrip(out1);
        const out3 = roundTrip(out2);
        expect(out2).toBe(out1);
        expect(out3).toBe(out1);
        // Every comment text appears in output
        for (const c of [
            "// header",
            "// leading-a2",
            "// inline-a2",
            "/* between block */",
            "// inline-b",
            "// before return",
            "// tail-1",
            "/* tail-2 */",
        ]) {
            expect(out1).toContain(c);
        }
    });

    test("inner-comment-only workflow combined via multi-parse remains stable", () => {
        const src = `workflow w(): string {
    // only inner
}`;
        assertStable(src);
        const wf = parse(src);
        expect(wf.body).toHaveLength(0);
        expect(wf.innerComments).toHaveLength(1);
        expect(wf.innerComments![0].text).toBe("// only inner");
    });
});
