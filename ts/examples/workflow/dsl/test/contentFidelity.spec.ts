// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Content-fidelity tests for the formatter.
 *
 * The user's rule is "complete fidelity for any content (except
 * spacing and line breaks)". To verify that across the whole DSL,
 * we apply three layers of checks:
 *
 *   1. **Data fidelity** (applies to ALL inputs, including
 *      `examples/*.wf`). Asserts that the multisets of identifiers,
 *      literals (string / number / boolean / null / template-string
 *      parts), and comment lexemes in `format(parse(src))` are
 *      identical to those in `src`. This is the strictest form of
 *      "no content loss" — every user-supplied name, value, and
 *      comment must survive verbatim, in the same count.
 *
 *   2. **Strict token-stream fidelity** (applies to fixtures that
 *      do not trigger any of the documented canonicalizations).
 *      Asserts that the ordered sequence of all token (kind, value)
 *      pairs is identical. This catches accidental reorderings or
 *      drops of punctuation that the data-fidelity layer would miss.
 *
 *   3. **Pinned canonicalizations** — the formatter intentionally
 *      transforms a small handful of constructs:
 *        a. Expression-bodied arrows are wrapped in
 *           `{ return ... ; }` (the AST has no ArrowFunction node).
 *        b. Multi-line parameter / argument / object-type lists
 *           always carry a trailing comma.
 *      Both are documented in formatter-design.md and pinned
 *      here so any change is loud.
 *
 * The cleanest answer to "do we have full content fidelity?" is
 * captured by layer 1 — and that's the layer we run over the whole
 * `examples/*.wf` corpus.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { lex } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { format, formatModule } from "../src/formatter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXAMPLES_DIR = path.resolve(__dirname, "../../../workflows/dsl");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAndFormat(src: string): string {
    const { tokens, errors: lexErrors, comments } = lex(src);
    if (lexErrors.length > 0) {
        throw new Error(
            `lex errors: ${lexErrors.map((e) => e.message).join(", ")}`,
        );
    }
    const p = new Parser(tokens, comments);
    const { ast, errors } = p.parseSingle();
    if (errors.length > 0) {
        throw new Error(
            `parse errors: ${errors.map((e) => e.message).join(", ")}`,
        );
    }
    return format(ast!);
}

/**
 * Multi-workflow round-trip: parse as a Module (imports + multiple
 * workflows) and re-emit via `formatModule`. Used for fixtures that
 * contain `import` or `export`.
 */
function parseAndFormatModule(src: string): string {
    const { tokens, errors: lexErrors, comments } = lex(src);
    if (lexErrors.length > 0) {
        throw new Error(
            `lex errors: ${lexErrors.map((e) => e.message).join(", ")}`,
        );
    }
    const p = new Parser(tokens, comments);
    const { module, errors } = p.parseModule();
    if (errors.length > 0) {
        throw new Error(
            `parse errors: ${errors.map((e) => e.message).join(", ")}`,
        );
    }
    return formatModule(module);
}

interface Multiset {
    [key: string]: number;
}

function inc(m: Multiset, k: string): void {
    m[k] = (m[k] ?? 0) + 1;
}

/** Token kinds whose `value` carries user-supplied content. */
const CONTENT_KINDS = new Set<string>([
    "Identifier",
    "StringLiteral",
    "NumberLiteral",
    "BooleanLiteral",
    "NullLiteral",
    "TemplateHead",
    "TemplateMiddle",
    "TemplateTail",
    "TemplateNoSub",
]);

/**
 * Extract the "data multiset" of a source: every identifier, literal,
 * template-string part (by value), plus every comment lexeme. These are
 * the things the formatter must preserve verbatim under any rule that
 * allows spacing / line-break / trailing-comma / arrow-wrap differences.
 */
function dataMultisetOf(src: string): Multiset {
    const { tokens, comments } = lex(src);
    const m: Multiset = {};
    for (const t of tokens) {
        if (CONTENT_KINDS.has(String(t.kind))) {
            inc(m, `${String(t.kind)}|${t.value}`);
        }
    }
    for (const c of comments) {
        inc(m, `Comment|${c.text}`);
    }
    return m;
}

function tokenStreamOf(src: string): string[] {
    const { tokens } = lex(src);
    return tokens
        .filter((t) => String(t.kind) !== "EOF")
        .map((t) => `${String(t.kind)}|${t.value}`);
}

function multisetDiff(
    label: string,
    expected: Multiset,
    actual: Multiset,
): string | null {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    const diffs: string[] = [];
    for (const k of keys) {
        const e = expected[k] ?? 0;
        const a = actual[k] ?? 0;
        if (e !== a) diffs.push(`  ${k}: src=${e} format=${a}`);
    }
    if (diffs.length === 0) return null;
    return `[${label}] data multiset differs:\n${diffs.join("\n")}`;
}

function assertDataFidelity(src: string, label: string): void {
    const formatted = isModuleSource(src)
        ? parseAndFormatModule(src)
        : parseAndFormat(src);
    const before = dataMultisetOf(src);
    const after = dataMultisetOf(formatted);
    const diff = multisetDiff(label, before, after);
    if (diff) throw new Error(diff);
    expect(true).toBe(true);
}

/** A source is a Module source (must use parseModule/formatModule) iff
 *  it contains `import` or `export` at statement position. */
function isModuleSource(src: string): boolean {
    return /^\s*(import|export)\b/m.test(src);
}

function tokenStreamDiff(
    label: string,
    expected: string[],
    actual: string[],
): string | null {
    const n = Math.max(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
        if (expected[i] !== actual[i]) {
            return (
                `[${label}] token stream diverges at index ${i}\n` +
                `  src    : ${expected[i] ?? "<missing>"}\n` +
                `  format : ${actual[i] ?? "<missing>"}\n` +
                `  context src    : ${expected
                    .slice(Math.max(0, i - 2), i + 3)
                    .join("  ")}\n` +
                `  context format : ${actual
                    .slice(Math.max(0, i - 2), i + 3)
                    .join("  ")}`
            );
        }
    }
    if (expected.length !== actual.length) {
        return `[${label}] token stream length differs: src=${expected.length} format=${actual.length}`;
    }
    return null;
}

function assertStrictTokenFidelity(src: string, label: string): void {
    const formatted = parseAndFormat(src);
    const diff = tokenStreamDiff(
        label,
        tokenStreamOf(src),
        tokenStreamOf(formatted),
    );
    if (diff) throw new Error(diff);
    expect(true).toBe(true);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Per-feature fixtures that DO NOT trigger any documented
 * canonicalization. These are kept under printWidth (so no
 * trailing-comma insertion) and use block-bodied arrows (so no
 * arrow-wrap). The strict token-stream oracle applies.
 */
const STRICT_FIXTURES: { name: string; src: string }[] = [
    {
        name: "minimal: empty workflow body",
        src: `workflow w(): void {\n}\n`,
    },
    {
        name: "const + return with literal-kind sample",
        src: `workflow w(): string {
    const a = "hello";
    const b = 42;
    const c = true;
    const d = null;
    return a;
}
`,
    },
    {
        name: "task call with dotted name + interpolation",
        src: `workflow w(): string {
    const x = a.b.c("k", 1, true);
    const y = \`hi \${x} done\`;
    return y;
}
`,
    },
    {
        name: "if / else with logical and comparison operators",
        src: `workflow w(): number {
    const a = 1;
    const b = 2;
    if (a === b && a !== 0 || !(a < b)) {
        return a;
    } else {
        return b;
    }
}
`,
    },
    {
        name: "switch with bare-arm bodies (no wrapping braces) + default + break + throw",
        src: `workflow w(): number {
    const k = "x";
    switch (k) {
        case "a":
            return 1;
        case "b":
            throw "no";
        default:
            return 0;
    }
}
`,
    },
    {
        name: "ternary + arithmetic + member access + array literal",
        src: `workflow w(): number {
    const xs = [1, 2, 3];
    const m = xs.length > 0 ? xs.length * 2 + 1 : 0 - 1;
    return m;
}
`,
    },
    {
        name: "built-ins with block-bodied arrows (no canonicalization)",
        src: `workflow w(): number {
    const a = attempts(3, () => {
        return svc.task();
    }, (err) => {
        return svc.fallback();
    });
    return a;
}
`,
    },
    {
        name: "object-type parameter (inline, fits) + array type",
        src: `workflow w(o: { foo: number, bar: string }, ks: number[]): number[] {
    return ks;
}
`,
    },
    {
        name: "every comment slot: leading / trailing / inner / between params / pre-case / inside object type",
        src: `// before workflow
workflow w(
    // before param a
    a: number, // trailing a
    b: string,
    /* between b and o */
    o: {
        // before foo
        foo: number, // trailing foo
        bar: string,
        /* inside object type after last field */
    },
): number {
    // inside workflow body, top
    const x = 1; // inline trailing on const
    /* between statements */
    if (x === 1) {
        /* inside then */
    }
    // between then and else
    else {
        /* inside else */
    }
    switch (x) {
        /* inside switch body, before first arm */
        // before case 1
        case 1:
            return x;
        // before case 2
        case 2:
        // before default
        default:
            return 0;
    }
    // before final return
    return x; // trailing return
}
`,
    },
    {
        name: "every comment shape: //, /* */, /**/ degenerate, multi-line block",
        src: `workflow w(): number {
    // line
    /* single-line block */
    /**/
    /*
     * multi
     * line
     */
    const x = 1;
    return x;
}
`,
    },
    {
        name: "deeply nested if / map / filter / attempts mix (block-bodied arrows)",
        src: `workflow w(): number {
    const xs = [1, 2, 3];
    const r = map(xs, (x) => {
        const y = attempts(2, () => {
            return x.work();
        }, (err) => {
            return x.fallback();
        });
        if (y === null) {
            return filter(xs, (z) => {
                return z.isOk();
            });
        } else {
            return parallelMap(xs, (z) => {
                return z.go();
            });
        }
    });
    return r;
}
`,
    },
];

// ---------------------------------------------------------------------------
// 1. Data fidelity over examples/*.wf
// ---------------------------------------------------------------------------

describe("content fidelity (data): examples/*.wf preserve all identifiers, literals, and comments", () => {
    if (!fs.existsSync(EXAMPLES_DIR)) {
        test.skip("examples directory not available in this build", () => {});
        return;
    }
    const files = fs
        .readdirSync(EXAMPLES_DIR)
        .filter((f) => f.endsWith(".wf"))
        .sort();
    if (files.length === 0) {
        test.skip("no .wf example files found", () => {});
        return;
    }
    for (const f of files) {
        test(`example: ${f}`, () => {
            const src = fs.readFileSync(path.join(EXAMPLES_DIR, f), "utf8");
            // Parse first to confirm the example is well-formed. Any
            // tokens beyond the first workflow are out of scope for the
            // formatter (parseSingle reads one workflow).
            assertDataFidelity(src, f);
        });
    }
});

// ---------------------------------------------------------------------------
// 2. Data fidelity over per-feature fixtures
// ---------------------------------------------------------------------------

describe("content fidelity (data): per-feature fixtures preserve all identifiers, literals, and comments", () => {
    for (const c of STRICT_FIXTURES) {
        test(c.name, () => assertDataFidelity(c.src, c.name));
    }
});

// ---------------------------------------------------------------------------
// 3. Strict token-stream fidelity over per-feature fixtures (kept under
//    printWidth + use block-bodied arrows so no canonicalization fires)
// ---------------------------------------------------------------------------

describe("content fidelity (strict tokens): no-canonicalization fixtures preserve the exact token stream", () => {
    for (const c of STRICT_FIXTURES) {
        test(c.name, () => assertStrictTokenFidelity(c.src, c.name));
    }
});

// ---------------------------------------------------------------------------
// 4. Kitchen-sink combined source — data fidelity only (uses block-bodied
//    arrows so token-stream is also preserved, but we double up on data
//    fidelity since this exercises every feature at once).
// ---------------------------------------------------------------------------

describe("content fidelity: kitchen-sink combined source", () => {
    const SRC = `// pre-workflow leading
workflow kitchen(
    // pre-a
    a: number, /* between a and b */ b: string,
    o: {
        /* pre-foo */
        foo: number, // trailing foo
        bar: string,
    },
): string {
    // body start
    const greeting = \`hello \${a} \${b}\`;
    const xs = [1, 2, 3, 4];

    if (a === 0 && b !== "") {
        // inside then
        return greeting;
    } /* between } and else */ else if (a < 10 || !(a > 100)) {
        return b;
    } else {
        // inside trailing else
        return null;
    }

    switch (a) {
        // before case 0
        case 0:
            throw "zero";
        case 1:
            break;
        /* before default */
        default:
            return greeting;
    }
}
`;

    test("data fidelity: every identifier, literal, and comment preserved", () => {
        assertDataFidelity(SRC, "kitchen-sink");
    });

    test("strict token fidelity: token stream identical (no canonicalization triggers)", () => {
        assertStrictTokenFidelity(SRC, "kitchen-sink");
    });

    test("idempotent across additional format passes", () => {
        const f1 = parseAndFormat(SRC);
        const f2 = parseAndFormat(f1);
        const f3 = parseAndFormat(f2);
        expect(f2).toBe(f3);
        // Data fidelity also holds across each pass.
        const ds = dataMultisetOf(SRC);
        const d1 = dataMultisetOf(f1);
        expect(multisetDiff("pass1", ds, d1)).toBe(null);
        expect(multisetDiff("pass2", ds, dataMultisetOf(f2))).toBe(null);
        expect(multisetDiff("pass3", ds, dataMultisetOf(f3))).toBe(null);
    });
});

// ---------------------------------------------------------------------------
// 5. Documented canonicalizations — pinned so any change is loud.
//    These are NOT spaces-or-line-breaks differences; they're documented,
//    intentional token-level transformations the formatter is allowed to
//    make while still preserving the data multiset.
// ---------------------------------------------------------------------------

describe("documented canonicalizations: expression-bodied arrow → block-bodied arrow", () => {
    test("`(x) => x.foo()` is canonicalized to `(x) => { return x.foo(); }`", () => {
        const src = `workflow w(): number {
    const a = map([1, 2], (x) => x.foo());
    return a;
}
`;
        const out = parseAndFormat(src);
        // The arrow body now contains `return x.foo();`.
        expect(out).toContain("(x) => {");
        expect(out).toContain("return x.foo();");
        // Data fidelity holds: all identifiers + literals + comments preserved.
        assertDataFidelity(src, "arrow-wrap");
    });

    test("attempts / map / filter / parallel / parallelMap with expression arrows: all bodies wrapped", () => {
        const src = `workflow w(): number {
    const a = attempts(2, () => svc.go(), (err) => svc.fb());
    const b = map([1], (x) => x.foo());
    const c = filter([1], (x) => x.isOk());
    const d = parallelMap([1], (x) => x.run());
    return a;
}
`;
        const out = parseAndFormat(src);
        expect(
            (out.match(/=> \{\n\s*return /g) ?? []).length,
        ).toBeGreaterThanOrEqual(5);
        assertDataFidelity(src, "all-built-ins-arrow-wrap");
    });
});

// ---------------------------------------------------------------------------
// 6. Previously-pinned gaps — now closed. Kept as positive round-trip
//    tests to prevent regression.
// ---------------------------------------------------------------------------

describe("previously-pinned fidelity gaps (now closed)", () => {
    test("end-of-file comment after the workflow's closing `}` survives", () => {
        const src = `workflow w(): number {\n    return 1;\n}\n// trailing-of-file\n`;
        assertDataFidelity(src, "eof-comment");
        const out = parseAndFormat(src);
        expect(out).toContain("// trailing-of-file");
    });

    test("attempts fallback parameter name elided in source is not re-introduced", () => {
        const src = `workflow w(): number {
    const a = attempts(2, () => {
        return svc.go();
    }, () => {
        return svc.fb();
    });
    return a;
}
`;
        assertDataFidelity(src, "attempts-fallback-noparam");
        const out = parseAndFormat(src);
        // Fallback emitted as `() =>`, not `(err) =>`.
        expect(out).toMatch(/\}, \(\) => \{/);
    });

    test("attempts fallback parameter name present in source is preserved", () => {
        const src = `workflow w(): number {
    const a = attempts(2, () => {
        return svc.go();
    }, (myErr) => {
        return svc.fb();
    });
    return a;
}
`;
        assertDataFidelity(src, "attempts-fallback-myErr");
        const out = parseAndFormat(src);
        expect(out).toMatch(/\(myErr\) => \{/);
    });

    test("end-of-file block comment also survives", () => {
        const src = `workflow w(): number {\n    return 1;\n}\n/* end of file */\n`;
        assertDataFidelity(src, "eof-block-comment");
        const out = parseAndFormat(src);
        expect(out).toContain("/* end of file */");
    });
});

describe("documented canonicalizations: trailing comma on multi-line lists", () => {
    test("long inline param list overflows printWidth, becomes multi-line with trailing comma; data preserved", () => {
        const src =
            `workflow w(` +
            Array.from({ length: 20 }, (_, i) => `p${i}: string`).join(", ") +
            `): string {\n    return p0;\n}\n`;
        const out = parseAndFormat(src);
        // Output is multi-line and the last param carries a trailing comma.
        expect(out).toContain("p19: string,\n)");
        assertDataFidelity(src, "long-param-list");
    });

    test("multi-line ObjectType: trailing comma added on last field; data preserved", () => {
        const src = `workflow w(o: {
    foo: number,
    bar: string
}): number {
    return 1;
}
`;
        const out = parseAndFormat(src);
        // The formatter adds a trailing comma after `bar: string`.
        expect(out).toMatch(/bar: string,\n\s*\}\)/);
        assertDataFidelity(src, "multi-line-object-type");
    });

    test("printWidth: Infinity keeps inline param list inline (no trailing comma added)", () => {
        const src =
            `workflow w(` +
            Array.from({ length: 20 }, (_, i) => `p${i}: string`).join(", ") +
            `): string {\n    return p0;\n}\n`;
        const { tokens, comments } = lex(src);
        const { ast } = new Parser(tokens, comments).parseSingle();
        const out = format(ast!, { printWidth: Infinity });
        // Still one line — no trailing comma inserted because we stayed inline.
        expect(out).toContain("p19: string)");
        // Strict token fidelity holds when no canonicalization fires.
        const diff = tokenStreamDiff(
            "printWidth:Infinity",
            tokenStreamOf(src),
            tokenStreamOf(out),
        );
        expect(diff).toBe(null);
    });
});

// ---------------------------------------------------------------------------
// 7. Cross-product: comment shapes × comment slots
//
//   Single combinatorial sweep that places each comment shape into each
//   reachable slot and asserts data fidelity. Each individual slot has
//   per-slot tests elsewhere — this guards against an integration bug
//   where two slots (or a slot + a shape) interact incorrectly when
//   they appear together in the same workflow.
// ---------------------------------------------------------------------------

describe("cross-product: comment shapes × slots are all preserved together", () => {
    // Note: line-comment shapes are intentionally excluded from
    // type-expression-internal slots (object-type field leading /
    // inner). Putting a `// L` mid-type-expression swallows the rest
    // of the type's tokens up to a newline, which is a grammar
    // limitation of single-line type expressions — not a fidelity gap.
    const SHAPES: Record<string, { c: string; lineOk: boolean }> = {
        line: { c: "// L", lineOk: true },
        block: { c: "/* B */", lineOk: false },
        multiLineBlock: { c: "/*\n   M1\n   M2\n*/", lineOk: true },
        emptyBlock: { c: "/**/", lineOk: false },
        emptyLine: { c: "//", lineOk: true },
        docBlock: { c: "/** D */", lineOk: false },
    };

    // Each slot is a small standalone workflow with ONE comment
    // placed into ONE specific position. The matrix exercises every
    // (shape, slot) pair independently — so a failure pinpoints the
    // offending pair rather than a sea-of-errors mega-doc.
    type SlotBuilder = (c: string) => string;
    const SLOTS: Record<string, { build: SlotBuilder; lineSafe: boolean }> = {
        "workflow-leading": {
            build: (c) => `${c}\nworkflow w(): number { return 1; }\n`,
            lineSafe: true,
        },
        "param-leading": {
            build: (c) =>
                `workflow w(${c}\n    a: number): number { return a; }\n`,
            lineSafe: true,
        },
        "param-trailing-inline": {
            build: (c) =>
                `workflow w(\n    a: number, ${c}\n    b: number\n): number { return a; }\n`,
            lineSafe: true,
        },
        "workflow-body-leading": {
            build: (c) =>
                `workflow w(): number {\n    ${c}\n    return 1;\n}\n`,
            lineSafe: true,
        },
        "statement-trailing-inline": {
            build: (c) =>
                `workflow w(): number {\n    const r = 1; ${c}\n    return r;\n}\n`,
            lineSafe: true,
        },
        "if-then-inner-empty": {
            build: (c) =>
                `workflow w(): number {\n    if (true) { ${c} }\n    return 1;\n}\n`,
            // line comment opens a comment to end-of-line, including
            // the `}` — keep it block-only.
            lineSafe: false,
        },
        "if-else-inner-empty": {
            build: (c) =>
                `workflow w(): number {\n    if (true) { return 1; } else { ${c} }\n    return 1;\n}\n`,
            lineSafe: false,
        },
        "else-leading-between-brace-and-else": {
            build: (c) =>
                `workflow w(): number {\n    if (true) {\n        return 1;\n    } ${c} else {\n        return 2;\n    }\n}\n`,
            // line shape would swallow `else` to end of line; block-only.
            lineSafe: false,
        },
        "switch-inner-empty": {
            build: (c) =>
                `workflow w(a: number): number {\n    switch (a) {\n        ${c}\n    }\n    return a;\n}\n`,
            lineSafe: true,
        },
        "default-arm-leading": {
            build: (c) =>
                `workflow w(a: number): number {\n    switch (a) {\n        ${c}\n        default: return a;\n    }\n    return a;\n}\n`,
            lineSafe: true,
        },
        "attempts-body-inner-empty": {
            build: (c) =>
                `workflow w(): number {\n    const r = attempts(1, () => { ${c} });\n    return r;\n}\n`,
            lineSafe: false,
        },
        "attempts-fallback-body-inner-empty": {
            build: (c) =>
                `workflow w(): number {\n    const r = attempts(1, () => { return 1; }, (e) => { ${c} });\n    return r;\n}\n`,
            lineSafe: false,
        },
        "map-body-inner-empty": {
            build: (c) =>
                `workflow w(): number[] {\n    const r = map([1], (x) => { ${c} });\n    return r;\n}\n`,
            lineSafe: false,
        },
        "filter-body-inner-empty": {
            build: (c) =>
                `workflow w(): number[] {\n    const r = filter([1], (x) => { ${c} });\n    return r;\n}\n`,
            lineSafe: false,
        },
        "object-type-field-leading": {
            build: (c) =>
                `workflow w(o: {\n    ${c}\n    foo: number,\n    bar: string\n}): number { return 1; }\n`,
            lineSafe: true,
        },
        "object-type-inner-empty": {
            build: (c) =>
                `workflow w(o: {\n    ${c}\n}): number { return 1; }\n`,
            lineSafe: true,
        },
        "eof-trailing": {
            build: (c) => `workflow w(): number { return 1; }\n${c}\n`,
            lineSafe: true,
        },
        "workflow-inner-empty": {
            build: (c) => `workflow w(): number {\n    ${c}\n}\n`,
            // Empty body has no return; not legal — skip via a body
            // that retains return.
            lineSafe: false,
        },
    };

    for (const [shapeName, { c, lineOk }] of Object.entries(SHAPES)) {
        for (const [slotName, { build, lineSafe }] of Object.entries(SLOTS)) {
            const isLineShape = c === "// L" || c === "//";
            if (isLineShape && !lineOk) continue;
            if (isLineShape && !lineSafe) continue;
            // workflow-inner-empty needs a return; skip — separate test below.
            if (slotName === "workflow-inner-empty") continue;
            test(`shape=${shapeName} slot=${slotName}`, () => {
                const src = build(c);
                assertDataFidelity(src, `xprod-${shapeName}-${slotName}`);
            });
        }
    }

    // Stack ALL six shapes adjacently in a single leading slot — pins
    // that a heterogeneous sequence of comments survives as one
    // contiguous group on round-trip.
    test("stack of every shape in one leading slot survives", () => {
        const stack = Object.values(SHAPES)
            .map((s) => s.c)
            .join("\n");
        const src = `${stack}\nworkflow w(): number { return 1; }\n`;
        assertDataFidelity(src, "all-shapes-stacked");
    });

    // Adjacent same-line trailing + leading on the same statement.
    test("block trailing + next-statement block leading on same line", () => {
        const src = `workflow w(): number {
    const a = 1; /* trailA */ /* leadB */
    const b = 2;
    return a;
}
`;
        assertDataFidelity(src, "adjacent-trailing-leading");
    });
});
