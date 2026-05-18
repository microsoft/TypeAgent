// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * G8 round-3 test-gap pass 1.
 *
 * Round 3 closed three full-comment-fidelity gaps:
 *   (a) comments between/around parameters (ParamDecl.leading/trailingComments,
 *       WorkflowDecl.paramInnerComments)
 *   (b) comments inside empty nested blocks on every block-bearing AST node
 *       (then/elseInnerComments, defaultInnerComments, SwitchArm.innerComments,
 *       AttemptsNode + fallback bodyInnerComments, Map/Filter/ParallelMap/
 *       Parallel branch bodyInnerComments)
 *   (c) comments between `}` and `else` (IfStatement.elseLeadingComments).
 *
 * The existing `trailingComments.spec.ts` covers the basic shape of each
 * surface. This file targets the residual gaps:
 *   - multi-line block comments in each new comment slot (the round-2
 *     indent-accumulation bug must not regress in any of the new slots)
 *   - structural-equivalence (stripTrivia) of parse-format-parse for each
 *     new surface
 *   - else-if chains carrying elseLeadingComments at every junction
 *   - attempts fallback body + parallelMap body inner comments (rounded
 *     out from the existing main-body-only tests)
 *   - empty parallel branch sandwiched between non-empty branches
 *   - single param with BOTH leading + trailing (ordering)
 *   - param with array-type trailing comment (endLine tracking after `]`)
 */

import { lex } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { format } from "../src/formatter.js";
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

function assertStable(source: string): string {
    const once = roundTrip(source);
    const twice = format(parse(once));
    const thrice = format(parse(twice));
    expect(twice).toBe(once);
    expect(thrice).toBe(once);
    return once;
}

/**
 * Mirror of the stripper in pass2-coverage.spec.ts. Drops every comment
 * slot and every source-location field so two ASTs from "same source modulo
 * comments and formatting" compare equal.
 */
function stripTrivia(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripTrivia);
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            if (
                k === "leadingComments" ||
                k === "trailingComments" ||
                k === "innerComments" ||
                k === "paramInnerComments" ||
                k === "thenInnerComments" ||
                k === "elseInnerComments" ||
                k === "elseLeadingComments" ||
                k === "defaultInnerComments" ||
                k === "bodyInnerComments" ||
                k === "endLine"
            ) {
                continue;
            }
            if (
                k === "pos" ||
                k === "loc" ||
                k === "line" ||
                k === "col" ||
                k === "offset"
            ) {
                continue;
            }
            out[k] = stripTrivia(v);
        }
        return out;
    }
    return value;
}

function assertStripEqual(a: string, b: string): void {
    expect(stripTrivia(parse(a))).toEqual(stripTrivia(parse(b)));
}

// ---------------------------------------------------------------------------
// 1. Multi-line block comments in each new inner-comment slot.
//    Pins the writeMultilineCommentText invariant: re-formatting must NOT
//    add indent to the second line of a multi-line block comment.
// ---------------------------------------------------------------------------

describe("round 3 gaps: multi-line block comments in new inner-comment slots", () => {
    test("paramInnerComments with multi-line block comment is stable", () => {
        const src = `workflow w(
    /* line one
       line two */
): string {
    return "x";
}`;
        const out = assertStable(src);
        // Second line of the block comment must not have accumulated indent.
        expect(out).toContain("line one\n       line two");
    });

    test("thenInnerComments with multi-line block comment is stable", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        /* first
           second */
    }
    return "x";
}`;
        const out = assertStable(src);
        expect(out).toContain("first\n           second");
    });

    test("elseInnerComments with multi-line block comment is stable", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        return "a";
    } else {
        /* alpha
           beta */
    }
    return "x";
}`;
        const out = assertStable(src);
        expect(out).toContain("alpha\n           beta");
    });

    test("attempts bodyInnerComments with multi-line block comment is stable", () => {
        const src = `workflow w(): string {
    const x = attempts(3, () => {
        /* retry
           later */
    });
    return "ok";
}`;
        const out = assertStable(src);
        expect(out).toContain("retry\n           later");
    });

    test("multi-line block comment between } and else (elseLeadingComments) is stable", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        return "a";
    } /* note one
         note two */ else {
        return "b";
    }
}`;
        const out = assertStable(src);
        expect(out).toContain("note one\n         note two");
    });
});

// ---------------------------------------------------------------------------
// 2. else-if chains with elseLeadingComments at every junction.
// ---------------------------------------------------------------------------

describe("round 3 gaps: else-if chains with elseLeadingComments at every junction", () => {
    test("block comment between every } and else-if/else is stable", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        return "a";
    } /* j1 */ else if (x === 2) {
        return "b";
    } /* j2 */ else if (x === 3) {
        return "c";
    } /* j3 */ else {
        return "d";
    }
}`;
        const out = assertStable(src);
        expect(out).toContain("/* j1 */");
        expect(out).toContain("/* j2 */");
        expect(out).toContain("/* j3 */");
    });

    test("line comment at every } in an else-if chain forces newlines and is stable", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        return "a";
    } // j1
    else if (x === 2) {
        return "b";
    } // j2
    else {
        return "c";
    }
}`;
        const out = roundTrip(src);
        // Re-formatting the formatter's output must be a no-op.
        expect(format(parse(out))).toBe(out);
        // After each line comment, the else/else-if must live on its own line.
        const lines = out.split("\n");
        const elseLines = lines.filter((l) => l.trim().startsWith("else"));
        expect(elseLines.length).toBeGreaterThanOrEqual(2);
        expect(out).toContain("// j1");
        expect(out).toContain("// j2");
    });
});

// ---------------------------------------------------------------------------
// 3. Surfaces previously only tested on the "primary" body.
// ---------------------------------------------------------------------------

describe("round 3 gaps: bodyInnerComments on secondary built-in surfaces", () => {
    test("attempts fallback body inner comment round-trips", () => {
        const src = `workflow w(): string {
    const x = attempts(3, () => {
        return "main";
    }, (err) => {
        // fallback note
    });
    return x;
}`;
        const out = assertStable(src);
        expect(out).toContain("// fallback note");
    });

    test("parallelMap body inner comment round-trips", () => {
        const src = `workflow w(xs: string[]): string[] {
    return parallelMap(xs, (item) => {
        // pm note
    });
}`;
        const out = assertStable(src);
        expect(out).toContain("// pm note");
    });

    test("filter body inner comment round-trips", () => {
        const src = `workflow w(xs: string[]): string[] {
    return filter(xs, (item) => {
        // filter note
    });
}`;
        const out = assertStable(src);
        expect(out).toContain("// filter note");
    });

    test("parallel with maxConcurrency + inner comment in branch round-trips", () => {
        const src = `workflow w(): string {
    const x = parallel(() => {
        // branch only
    }, () => {
        return "b";
    }, { maxConcurrency: 2 });
    return "ok";
}`;
        const out = assertStable(src);
        expect(out).toContain("// branch only");
        expect(out).toContain("maxConcurrency: 2");
    });

    test("empty parallel branch sandwiched between non-empty branches round-trips", () => {
        const src = `workflow w(): string {
    const x = parallel(() => {
        return "a";
    }, () => {
        // middle empty
    }, () => {
        return "c";
    });
    return "ok";
}`;
        const out = assertStable(src);
        expect(out).toContain("// middle empty");
        // The middle branch should still emit "// middle empty" inside its `{ }`
        // (i.e. not migrate to a neighbour).
        const idx = out.indexOf("// middle empty");
        const before = out.slice(0, idx);
        const after = out.slice(idx);
        // The comment must be between an opening `{` and a closing `}`, both
        // belonging to the middle branch.
        expect(before.lastIndexOf("{")).toBeGreaterThan(
            before.lastIndexOf("}"),
        );
        expect(after.indexOf("}")).toBeLessThan(after.indexOf("{"));
    });
});

// ---------------------------------------------------------------------------
// 4. Parameter edge cases.
// ---------------------------------------------------------------------------

describe("round 3 gaps: parameter edge cases", () => {
    test("single param with BOTH leading and inline trailing preserves source order", () => {
        const src = `workflow w(
    // before
    a: number, // after
): string {
    const x = a;
    return "x";
}`;
        const out = assertStable(src);
        const beforeIdx = out.indexOf("// before");
        const aIdx = out.indexOf("a: number");
        const afterIdx = out.indexOf("// after");
        expect(beforeIdx).toBeGreaterThanOrEqual(0);
        expect(aIdx).toBeGreaterThan(beforeIdx);
        expect(afterIdx).toBeGreaterThan(aIdx);
    });

    test("param with array type carries trailing comment (endLine after `]`)", () => {
        const src = `workflow w(
    xs: string[], // a list
    n: number,
): string {
    return "x";
}`;
        const out = assertStable(src);
        // The trailing should stay on the SAME line as `xs: string[],`, not
        // migrate to the next param's leading slot.
        const xsLine = out.split("\n").find((l) => l.includes("xs: string[]"));
        expect(xsLine).toBeDefined();
        expect(xsLine!).toContain("// a list");
    });

    test("paramInnerComments with both line and block comments preserves order", () => {
        const src = `workflow w(
    // first
    /* second */
    // third
): string {
    return "x";
}`;
        const out = assertStable(src);
        const i1 = out.indexOf("// first");
        const i2 = out.indexOf("/* second */");
        const i3 = out.indexOf("// third");
        expect(i1).toBeGreaterThanOrEqual(0);
        expect(i2).toBeGreaterThan(i1);
        expect(i3).toBeGreaterThan(i2);
    });
});

// ---------------------------------------------------------------------------
// 5. Structural-equivalence property: parse(format(parse(src))) equals
//    parse(src) modulo stripTrivia for each new round-3 surface.
//    (Existing pass2-coverage tests cover the "no-comment-related" body
//    structures; this widens that property to every round-3 comment slot.)
// ---------------------------------------------------------------------------

describe("round 3 gaps: stripTrivia(parse(format(parse(src)))) == stripTrivia(parse(src))", () => {
    const cases: Record<string, string> = {
        "leading+trailing on params": `workflow w(
    // l
    a: number, // t
    b: string,
): string {
    return b;
}`,
        "elseInnerComments + elseLeadingComments": `workflow w(x: number): string {
    if (x === 1) {
        return "a";
    } /* gap */ else {
        // hi
    }
    return "x";
}`,
        defaultInnerComments: `workflow w(x: number): string {
    switch (x) {
        case 1:
            return "a";
        default:
            // d
    }
    return "x";
}`,
        "attempts main + fallback bodyInnerComments": `workflow w(): string {
    const x = attempts(3, () => {
        // m
    }, (err) => {
        // f
    });
    return "ok";
}`,
        "else-if chain with elseLeading at every junction": `workflow w(x: number): string {
    if (x === 1) {
        return "a";
    } /* j1 */ else if (x === 2) {
        return "b";
    } /* j2 */ else {
        return "c";
    }
}`,
    };

    for (const [name, src] of Object.entries(cases)) {
        test(name, () => {
            const formatted = format(parse(src));
            assertStripEqual(src, formatted);
        });
    }
});
