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
        expect(out).toContain(`const [a, b] = text.split(s: "x", sep: ","); // unpack`);
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
        expect(out.split("\n").every((seg, i, arr) =>
            i === arr.length - 1 ? true : seg.endsWith("\r"),
        )).toBe(true);
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
