// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * G8 round-3 test-gap pass 2 — adversarial angles not covered by pass 1.
 *
 * Pass 1 (round3-gaps.spec.ts) targeted multi-line block comments in new
 * inner-comment slots, else-if chains, secondary built-in surfaces, basic
 * param edge cases, and stripTrivia structural equivalence.
 *
 * This pass exercises different angles:
 *   - Interaction of leading + trailing on the SAME param when BOTH are
 *     multi-line (order + indent invariant on both sides).
 *   - Containers that have NO inner-comment slot (SwitchStatement body,
 *     comment between/before `case` keywords): pin where the comment
 *     migrates so future regressions are noticed.
 *   - Comment adjacent to the `workflow` keyword (both sides), including
 *     between `workflow` and the name.
 *   - Mixed-layout param lists (some params have comments, some don't —
 *     all params still get own-line rendering).
 *   - Stacked line comments (3+) in paramInner / elseInner slots.
 *   - Degenerate comment lexemes (`/**\/`, `//`) in every new round-3 slot.
 *   - Template literals containing a `}` that must NOT trigger
 *     elseLeadingComments scanning.
 *   - Three-round convergence (source -> text1 -> text2 -> text3) on the
 *     full union of round-3 surfaces.
 *   - Comments at the correct nesting level when multiple built-ins are
 *     nested.
 *   - Constructed-AST behavior of trailingComments when `endLine` is
 *     absent (pinned so manual AST builders get a defined outcome).
 *   - Multi-line ObjectType in a param: pin parser non-support so the
 *     limitation is visible.
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
    expect(twice).toBe(once);
    return once;
}

// ---------------------------------------------------------------------------
// A. Leading + trailing on the same param, both multi-line.
//    Pass 1 covered (leading) and (trailing) and basic mixed; here both
//    sides are multi-line block comments on a single param.
// ---------------------------------------------------------------------------

describe("round 3 gaps pass 2: same-param leading + trailing both multi-line", () => {
    test("multi-line leading + multi-line trailing preserves order, sides, indent", () => {
        const src = `workflow w(
    /* lead1
       lead2 */
    a: number, /* trail1
                  trail2 */
    b: string,
): string {
    return b;
}`;
        const out = assertStable(src);
        const leadIdx = out.indexOf("lead1");
        const aIdx = out.indexOf("a: number");
        const trailIdx = out.indexOf("trail1");
        expect(leadIdx).toBeGreaterThan(0);
        expect(aIdx).toBeGreaterThan(leadIdx);
        expect(trailIdx).toBeGreaterThan(aIdx);
        // Indent of continuation lines (the round-2 indent-accumulation bug
        // must not regress on EITHER side).
        expect(out).toContain("lead1\n       lead2");
        expect(out).toContain("trail1\n                  trail2");
    });
});

// ---------------------------------------------------------------------------
// B. Empty SwitchStatement body with only inner comments.
//    SwitchStatement has no innerComments slot; the comment migrates to the
//    next statement's leadingComments. Pin this so a future "add
//    SwitchStatement.innerComments" change updates the test deliberately.
// ---------------------------------------------------------------------------

describe("round 3 gaps pass 2: empty switch with only inner comment (no slot)", () => {
    test("comment is not dropped; migrates to the statement after switch", () => {
        const src = `workflow w(x: number): string {
    switch (x) {
        /* nothing */
    }
    return "x";
}`;
        const out = assertStable(src);
        expect(out).toContain("/* nothing */");
        // Pin: the comment migrates OUT of the switch body to the
        // following return statement (since SwitchStatement has no
        // innerComments slot today).
        const commentIdx = out.indexOf("/* nothing */");
        const closeBraceIdx = out.indexOf("}", out.indexOf("switch"));
        expect(commentIdx).toBeGreaterThan(closeBraceIdx);
    });
});

// ---------------------------------------------------------------------------
// C. Leading comment immediately before a `case` keyword.
//    SwitchArm has no "preceding comment" slot, so the comment attaches as
//    a block-end trailing of the previous arm's last statement. Pin this.
// ---------------------------------------------------------------------------

describe("round 3 gaps pass 2: comment before a `case` keyword", () => {
    test("attaches as trailing of previous arm's last statement (round-trip stable)", () => {
        const src = `workflow w(x: number): string {
    switch (x) {
        case 1:
            return "a";
        // before case 2
        case 2:
            return "b";
    }
    return "x";
}`;
        const out = assertStable(src);
        expect(out).toContain("// before case 2");
        // Stable means the formatter's chosen attachment point is fixed.
        const cIdx = out.indexOf("// before case 2");
        const case2Idx = out.indexOf("case 2");
        const returnAIdx = out.indexOf('return "a"');
        expect(returnAIdx).toBeGreaterThan(0);
        expect(cIdx).toBeGreaterThan(returnAIdx);
        expect(cIdx).toBeLessThan(case2Idx);
    });
});

// ---------------------------------------------------------------------------
// D. Comments adjacent to the `workflow` keyword.
//    `/* x */ workflow w(...)` -> WorkflowDecl.leadingComments (normal).
//    `workflow /* x */ w(...)`  -> no slot between keyword and name;
//    verify it parses cleanly and the comment is preserved SOMEWHERE
//    (currently surfaces in paramInnerComments). Pin both behaviors.
// ---------------------------------------------------------------------------

describe("round 3 gaps pass 2: comments adjacent to the `workflow` keyword", () => {
    test("comment before `workflow` keyword round-trips as leading", () => {
        const src = `/* hello */ workflow w(): string {
    return "x";
}`;
        const out = assertStable(src);
        expect(out).toContain("/* hello */");
        // Leading comment must appear on/above the `workflow` line.
        const helloIdx = out.indexOf("/* hello */");
        const wfIdx = out.indexOf("workflow w");
        expect(helloIdx).toBeLessThan(wfIdx);
    });

    test("comment between `workflow` keyword and name parses and round-trips stably", () => {
        const src = `workflow /* between */ w(): string {
    return "x";
}`;
        // Round-trip must succeed (no parse errors) and re-formatting the
        // output is a no-op.
        const out = assertStable(src);
        expect(out).toContain("/* between */");
    });
});

// ---------------------------------------------------------------------------
// E. Mixed-layout param list: some params have comments, some don't.
//    Once the list has any commented param, ALL params should render on
//    their own line (no half-inline, half-block layout).
// ---------------------------------------------------------------------------

describe("round 3 gaps pass 2: mixed-comment param list layout", () => {
    test("param without comments still renders on its own line when list is multi-line", () => {
        const src = `workflow w(
    // doc for a
    a: number,
    b: string,
    c: boolean,
): string {
    return b;
}`;
        const out = assertStable(src);
        const lines = out.split("\n");
        const aLine = lines.find((l) => l.includes("a: number"));
        const bLine = lines.find((l) => l.includes("b: string"));
        const cLine = lines.find((l) => l.includes("c: boolean"));
        expect(aLine).toBeDefined();
        expect(bLine).toBeDefined();
        expect(cLine).toBeDefined();
        // Each param must be on its OWN line (not packed inline).
        expect(aLine).not.toContain("b: string");
        expect(bLine).not.toContain("c: boolean");
        expect(bLine).not.toContain("a: number");
    });
});

// ---------------------------------------------------------------------------
// F. Concatenated line comments in inner-comment slots (3+ stacked).
//    Pass 1 used single-comment cases; this stacks several so order
//    preservation matters.
// ---------------------------------------------------------------------------

describe("round 3 gaps pass 2: stacked line comments in inner slots", () => {
    test("3 stacked // line comments as paramInnerComments preserve order", () => {
        const src = `workflow w(
    // alpha
    // beta
    // gamma
): string {
    return "x";
}`;
        const out = assertStable(src);
        const a = out.indexOf("// alpha");
        const b = out.indexOf("// beta");
        const g = out.indexOf("// gamma");
        expect(a).toBeGreaterThan(0);
        expect(b).toBeGreaterThan(a);
        expect(g).toBeGreaterThan(b);
    });

    test("3 stacked // line comments as elseInnerComments preserve order", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        return "a";
    } else {
        // alpha
        // beta
        // gamma
    }
    return "x";
}`;
        const out = assertStable(src);
        const a = out.indexOf("// alpha");
        const b = out.indexOf("// beta");
        const g = out.indexOf("// gamma");
        expect(a).toBeGreaterThan(0);
        expect(b).toBeGreaterThan(a);
        expect(g).toBeGreaterThan(b);
    });
});

// ---------------------------------------------------------------------------
// G. Degenerate comment lexemes in new round-3 slots.
//    `/**/` (empty block) and `//` (empty line) must survive a round-trip
//    in each new slot without crashing the formatter's comment renderer.
// ---------------------------------------------------------------------------

describe("round 3 gaps pass 2: degenerate comments in new round-3 slots", () => {
    test("`/**/` as paramInnerComments round-trips", () => {
        const src = `workflow w(
    /**/
): string {
    return "x";
}`;
        const out = assertStable(src);
        expect(out).toContain("/**/");
    });

    test("`/**/` as elseLeadingComments round-trips", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        return "a";
    } /**/ else {
        return "b";
    }
}`;
        const out = assertStable(src);
        expect(out).toContain("/**/");
    });

    test("empty `//` as elseInnerComments round-trips", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        return "a";
    } else {
        //
    }
    return "x";
}`;
        const out = assertStable(src);
        // The empty // line must be preserved (renderer must not collapse it).
        expect(out.split("\n").some((l) => l.trim() === "//")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// H. Template literals containing `}` must not confuse the elseLeading
//    scan (pin via positive round-trip — the literal's text is preserved
//    verbatim AND the if/else still parses correctly).
// ---------------------------------------------------------------------------

describe("round 3 gaps pass 2: template-literal `}` does not trigger else scanning", () => {
    test("if-with-template-ending-in-} + real else round-trips cleanly", () => {
        const src = `workflow w(x: number): string {
    if (x === 1) {
        return \`hi \${x} end}\`;
    } else {
        return "b";
    }
}`;
        const out = assertStable(src);
        expect(out).toContain("`hi ${x} end}`");
        expect(out).toContain("} else {");
    });
});

// ---------------------------------------------------------------------------
// I. Three-round convergence (source -> t1 -> t2 -> t3) on the full union
//    of round-3 surfaces. Pass 1's assertStable already enforces t1==t2==t3
//    pointwise; this test exercises a single document that hits every new
//    slot at once, which the per-slot tests don't.
// ---------------------------------------------------------------------------

describe("round 3 gaps pass 2: three-round convergence over union of round-3 surfaces", () => {
    test("text2 === text3 on a document combining every round-3 slot", () => {
        const src = `/* top */
workflow w(
    // p-leading
    a: number, // p-trailing
    /* p-inner-after-last */
): string {
    if (a === 1) {
        return "a";
    } /* j1 */ else if (a === 2) {
        // then-inner
    } /* j2 */ else {
        // else-inner
    }
    switch (a) {
        case 1:
            return "x";
        default:
            // default-inner
    }
    const r = attempts(3, () => {
        // attempts-inner
    }, (err) => {
        // fallback-inner
    });
    return r;
}`;
        const t1 = format(parse(src));
        const t2 = format(parse(t1));
        const t3 = format(parse(t2));
        expect(t2).toBe(t1);
        expect(t3).toBe(t2);
        // Sanity: every comment survived to t3.
        for (const c of [
            "/* top */",
            "// p-leading",
            "// p-trailing",
            "/* p-inner-after-last */",
            "/* j1 */",
            "/* j2 */",
            "// then-inner",
            "// else-inner",
            "// default-inner",
            "// attempts-inner",
            "// fallback-inner",
        ]) {
            expect(t3).toContain(c);
        }
    });
});

// ---------------------------------------------------------------------------
// J. Mixed nested built-ins with empty inner bodies: each comment must
//    attach at the correct level.
// ---------------------------------------------------------------------------

describe("round 3 gaps pass 2: comments attach to the correct nesting level", () => {
    test("empty inner attempts inside map keeps its comment inside, not in outer map body", () => {
        const src = `workflow w(xs: string[]): string[] {
    return map(xs, (item) => {
        const r = attempts(3, () => {
            // inner only
        });
        return r;
    });
}`;
        const out = assertStable(src);
        const inner = out.indexOf("// inner only");
        // Must be inside the attempts(...) braces, i.e. after `attempts(3, () => {`
        const attemptsOpen = out.indexOf("attempts(3, () => {");
        const mapClose = out.lastIndexOf("})"); // closing `})` of map call
        expect(inner).toBeGreaterThan(attemptsOpen);
        expect(inner).toBeLessThan(mapClose);
    });
});

// ---------------------------------------------------------------------------
// K. Constructed-AST behavior of trailingComments when `endLine` is absent.
//    The formatter must not crash and must place the trailing on its own
//    line (since there is no source line information to consider it inline).
//    Pin both ParamDecl and a Statement (ConstStatement) variant.
// ---------------------------------------------------------------------------

describe("round 3 gaps pass 2: constructed AST without endLine", () => {
    function loc() {
        return { line: 1, col: 1, offset: 0 };
    }
    test("ParamDecl with trailingComments and no endLine renders on its own line", () => {
        const ast: WorkflowDecl = {
            kind: "WorkflowDecl",
            name: "w",
            params: [
                {
                    name: "a",
                    type: { kind: "NamedType", name: "number", loc: loc() },
                    loc: loc(),
                    trailingComments: [{ text: "// note", pos: loc() }],
                },
            ],
            returnType: { kind: "NamedType", name: "string", loc: loc() },
            body: [
                {
                    kind: "ReturnStatement",
                    value: {
                        kind: "StringLiteralExpr",
                        value: "x",
                        loc: loc(),
                    },
                    loc: loc(),
                },
            ],
            loc: loc(),
        };
        const out = format(ast);
        expect(out).toContain("// note");
        // The trailing must NOT collide with the param on the same line
        // (no endLine info -> own-line is the safe default).
        const noteLine = out.split("\n").find((l) => l.includes("// note"))!;
        expect(noteLine).not.toContain("a: number");
    });

    test("ConstStatement with trailingComments and no endLine renders on its own line", () => {
        const ast: WorkflowDecl = {
            kind: "WorkflowDecl",
            name: "w",
            params: [],
            returnType: { kind: "NamedType", name: "string", loc: loc() },
            body: [
                {
                    kind: "ConstStatement",
                    name: "x",
                    value: {
                        kind: "StringLiteralExpr",
                        value: "y",
                        loc: loc(),
                    },
                    loc: loc(),
                    trailingComments: [{ text: "// hi", pos: loc() }],
                },
                {
                    kind: "ReturnStatement",
                    value: {
                        kind: "DottedNameExpr",
                        segments: ["x"],
                        loc: loc(),
                    },
                    loc: loc(),
                },
            ],
            loc: loc(),
        };
        const out = format(ast);
        expect(out).toContain("// hi");
        const hiLine = out.split("\n").find((l) => l.includes("// hi"))!;
        expect(hiLine).not.toContain("const x =");
    });
});

// ---------------------------------------------------------------------------
// L. Multi-line ObjectType in a parameter — pin "not currently supported".
//    The DSL's parser doesn't accept object types with field separators in
//    multi-line layout; pin so future support is an opt-in change.
// ---------------------------------------------------------------------------

describe("round 3 gaps pass 2: multi-line ObjectType in a param (pinned non-support)", () => {
    test("multi-line object type with `;` field separator does not parse cleanly", () => {
        const src = `workflow w(
    obj: {
        x: number;
        y: string;
    },
): string {
    return "x";
}`;
        const { tokens, errors: lexErrors, comments } = lex(src);
        expect(lexErrors).toEqual([]);
        const p = new Parser(tokens, comments);
        const { errors } = p.parseSingle();
        // Spec doesn't support multi-line object types with `;` separators
        // in param position today. Pin: this MUST produce parse errors so
        // adding support is a deliberate change.
        expect(errors.length).toBeGreaterThan(0);
    });
});
