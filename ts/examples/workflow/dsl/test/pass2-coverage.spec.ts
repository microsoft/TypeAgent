// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Test-gap pass 2 for G8 / formatter changeset.
 *
 * Covers areas pass 1 missed:
 *  1. Interaction of comments with typeChecker, graphExtractor, emitter.
 *  2. Stronger formatter "parseable" property: parse(format(parse(src)))
 *     is structurally equal to parse(src) (ignoring leadingComments).
 *  3. FormatOptions corner cases (indent: 0, very large, weird eol).
 *  4. Parser robustness when comments coexist with lex/parse errors.
 *  5. Concurrency / immutability of the comments array shared across parsers.
 *  6. compile() API shape (no AST surface).
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { lex } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { format } from "../src/formatter.js";
import { TypeChecker } from "../src/typeChecker.js";
import { Emitter, TaskSchemaInfo } from "../src/emitter.js";
import { extractGraph } from "../src/graphExtractor.js";
import { compile } from "../src/compiler.js";
import { WorkflowDecl } from "../src/ast.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Compiled tests run from dist/test, source examples live at src tree.
const EXAMPLES_DIR = path.resolve(__dirname, "../../examples");

function parseWithComments(source: string): WorkflowDecl {
    const { tokens, errors: lexErrors, comments } = lex(source);
    expect(lexErrors).toEqual([]);
    const parser = new Parser(tokens, comments);
    const { ast, errors } = parser.parseSingle();
    expect(errors).toEqual([]);
    expect(ast).toBeDefined();
    return ast!;
}

function parseNoComments(source: string): WorkflowDecl {
    const { tokens, errors: lexErrors } = lex(source);
    expect(lexErrors).toEqual([]);
    const parser = new Parser(tokens); // no comments argument
    const { ast, errors } = parser.parseSingle();
    expect(errors).toEqual([]);
    expect(ast).toBeDefined();
    return ast!;
}

/**
 * Recursively strip `leadingComments` and `pos`/source-location fields so two
 * ASTs from "same source modulo comments and formatting" compare equal.
 */
function stripTrivia(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripTrivia);
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            if (k === "leadingComments") continue;
            if (k === "trailingComments") continue;
            if (k === "innerComments") continue;
            if (k === "paramInnerComments") continue;
            if (k === "thenInnerComments") continue;
            if (k === "elseInnerComments") continue;
            if (k === "elseLeadingComments") continue;
            if (k === "defaultInnerComments") continue;
            if (k === "bodyInnerComments") continue;
            if (k === "endLine") continue;
            // Drop every source-position field. These shift when comments
            // appear or when the formatter re-emits the same AST.
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

// ---------------------------------------------------------------------------
// 1. Interaction with other components
// ---------------------------------------------------------------------------

describe("pass2: comments don't affect typeChecker", () => {
    const SCHEMAS: TaskSchemaInfo[] = [];

    test("workflow heavy with comments type-checks identically", () => {
        const bare = `workflow w(a: string): string {
            const x = a;
            if (true) { return x; } else { return "n"; }
        }`;
        const commented = `// header
        workflow w(a: string): string {
            /* before const */
            const x = a; // tail
            // before if
            if (true) {
                // then
                return x;
            } else {
                /* else */
                return "n";
            }
        }`;
        const errsBare = new TypeChecker(SCHEMAS).check(parseNoComments(bare));
        const errsCommented = new TypeChecker(SCHEMAS).check(
            parseWithComments(commented),
        );
        expect(errsBare).toEqual([]);
        expect(errsCommented).toEqual([]);
    });

    test("type error is still detected when comments surround the bad node", () => {
        const src = `workflow w(): string {
            // explain
            /* multi
               line */
            return 42; // wrong type
        }`;
        const errs = new TypeChecker([]).check(parseWithComments(src));
        expect(errs.length).toBeGreaterThan(0);
    });
});

describe("pass2: comments don't affect graphExtractor", () => {
    test("graph from commented source equals graph from bare source", () => {
        const bare = `workflow w(a: string): string {
            const x = a;
            return x;
        }`;
        const commented = `// h
        workflow w(a: string): string {
            /* c1 */
            const x = a;
            // c2
            return x;
        }`;
        const gBare = extractGraph(parseNoComments(bare));
        const gCommented = extractGraph(parseWithComments(commented));
        expect(stripTrivia(gCommented)).toEqual(stripTrivia(gBare));
    });

    test("graph from map+attempts with comments interspersed is unchanged", () => {
        const bare = `workflow w(urls: string[]): string[] {
            return map(urls, (u) => {
                return attempts(2, () => { return u; });
            });
        }`;
        const commented = `workflow w(urls: string[]): string[] {
            // map over urls
            return map(urls, (u) => {
                /* retry up to 2x */
                return attempts(2, () => {
                    // body
                    return u;
                });
            });
        }`;
        const gBare = extractGraph(parseNoComments(bare));
        const gCommented = extractGraph(parseWithComments(commented));
        expect(stripTrivia(gCommented)).toEqual(stripTrivia(gBare));
    });
});

describe("pass2: comments don't leak into emitter IR", () => {
    test("IR from commented source equals IR from bare source", () => {
        const bare = `workflow w(a: string): string {
            const x = a;
            return x;
        }`;
        const commented = `// header
        workflow w(a: string): string {
            // c1
            const x = a; /* tail */
            // c2
            return x;
        }`;
        const irBare = new Emitter([]).emit(parseNoComments(bare)).ir;
        const irCommented = new Emitter([]).emit(
            parseWithComments(commented),
        ).ir;
        expect(irBare).toBeDefined();
        expect(irCommented).toBeDefined();
        expect(irCommented).toEqual(irBare);
    });

    test("emitted IR JSON contains no 'leadingComments' field anywhere", () => {
        const src = `// h
        workflow w(a: string): string {
            // c
            const x = a;
            /* block */
            return x;
        }`;
        const ir = new Emitter([]).emit(parseWithComments(src)).ir!;
        const json = JSON.stringify(ir);
        expect(json).not.toContain("leadingComments");
        expect(json).not.toContain("// h");
        expect(json).not.toContain("/* block */");
    });
});

// ---------------------------------------------------------------------------
// 2. Stronger formatter property: parse(format(parse(src))) ≡ parse(src)
//    (modulo leadingComments and source positions).
// ---------------------------------------------------------------------------

function structurallyEqualAfterFormat(source: string): void {
    const ast1 = parseWithComments(source);
    const formatted = format(ast1);
    const ast2 = parseWithComments(formatted);
    expect(stripTrivia(ast2)).toEqual(stripTrivia(ast1));
}

describe("pass2: parse(format(parse(src))) structurally equals parse(src)", () => {
    test("inline: const + return", () => {
        structurallyEqualAfterFormat(`workflow w(a: string): string {
            const x = a;
            return x;
        }`);
    });

    test("inline: nested map/attempts", () => {
        structurallyEqualAfterFormat(`workflow w(urls: string[]): string[] {
            return map(urls, (u) => {
                return attempts(3, () => { return u; });
            });
        }`);
    });

    test("inline: if/else with switch inside", () => {
        structurallyEqualAfterFormat(`workflow w(a: string): string {
            if (a === "x") {
                return "x";
            } else {
                switch (a) {
                    case "y": return "y";
                    case "z": return "z";
                    default: return "n";
                }
            }
        }`);
    });

    test("example file: d8-summarize-url.wf", () => {
        const file = path.join(EXAMPLES_DIR, "d8-summarize-url.wf");
        if (!fs.existsSync(file)) {
            // examples dir may not be copied into dist; skip gracefully.
            return;
        }
        const src = fs.readFileSync(file, "utf8");
        structurallyEqualAfterFormat(src);
    });
});

// ---------------------------------------------------------------------------
// 3. FormatOptions corner cases
// ---------------------------------------------------------------------------

describe("pass2: FormatOptions corner cases", () => {
    const SAMPLE = `workflow w(a: string): string {
        if (true) { const x = a; return x; } else { return "n"; }
    }`;

    test("indent: 0 produces parseable output with no leading spaces", () => {
        const ast = parseNoComments(SAMPLE);
        const out = format(ast, { indent: 0 });
        // Must parse cleanly.
        expect(() => parseNoComments(out)).not.toThrow();
        // Inner lines should not start with spaces.
        for (const line of out.split("\n")) {
            if (line.length === 0) continue;
            expect(line.startsWith(" ")).toBe(false);
        }
    });

    test("very large indent (32) does not crash and stays parseable", () => {
        const ast = parseNoComments(SAMPLE);
        const out = format(ast, { indent: 32 });
        expect(() => parseNoComments(out)).not.toThrow();
        // Body statements should be indented by exactly 32 spaces.
        expect(out).toMatch(/\n {32}\S/);
    });

    test('eol: "\\n\\n" does not crash and stays parseable', () => {
        const ast = parseNoComments(SAMPLE);
        const out = format(ast, { eol: "\n\n" });
        expect(() => parseNoComments(out)).not.toThrow();
        // Double-newline between logical lines should appear.
        expect(out).toContain("\n\n");
    });

    test('eol: "\\r\\n" produces CRLF-terminated output that re-parses', () => {
        const ast = parseNoComments(SAMPLE);
        const out = format(ast, { eol: "\r\n" });
        expect(out).toContain("\r\n");
        expect(() => parseNoComments(out)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// 4. Parser robustness with comments
// ---------------------------------------------------------------------------

describe("pass2: parser robustness with comments", () => {
    test("lex errors and comments coexist on the same source", () => {
        // Unterminated string is a classic lex error.
        const src = `// header
        workflow w(): string { return "unterminated;
        }`;
        const { errors: lexErrors, comments } = lex(src);
        expect(lexErrors.length).toBeGreaterThan(0);
        // The header comment is still collected even though lex failed later.
        expect(comments.some((c) => c.text === "// header")).toBe(true);
    });

    test("parse error line/col is correct when a multi-line block comment shifts visual layout", () => {
        // Block comment occupies lines 2..4; the bad token `???` is on line 6.
        const src =
            `workflow w(): string {\n` + // line 1
            `    /* this\n` + // 2
            `       comment\n` + // 3
            `       spans */\n` + // 4
            `    const x = "ok";\n` + // 5
            `    ???\n` + // 6 — bogus tokens
            `    return x;\n` + // 7
            `}\n`; // 8
        const { tokens, comments } = lex(src);
        const parser = new Parser(tokens, comments);
        const { errors } = parser.parseSingle();
        expect(errors.length).toBeGreaterThan(0);
        // At least one error should point at line 6 (or just after) — i.e. NOT
        // confused into pointing at a comment line.
        const onSixOrLater = errors.some((e) => e.line >= 6);
        expect(onSixOrLater).toBe(true);
        // And the error must not be reported inside the block comment span.
        for (const e of errors) {
            expect(e.line).not.toBe(2);
            expect(e.line).not.toBe(3);
            expect(e.line).not.toBe(4);
        }
    });
});

// ---------------------------------------------------------------------------
// 5. Concurrency / immutability: same comments array, two Parsers
// ---------------------------------------------------------------------------

describe("pass2: comments array is safe to share across Parser instances", () => {
    test("two parsers fed the same comments array both attach comments and don't mutate it", () => {
        const src = `// h1
        workflow w(): string {
            // h2
            return "x";
        }`;
        const { tokens, comments } = lex(src);
        const snapshot = JSON.stringify(comments);
        const lenBefore = comments.length;

        const p1 = new Parser(tokens, comments);
        const p2 = new Parser(tokens, comments);
        const r1 = p1.parseSingle();
        const r2 = p2.parseSingle();

        expect(r1.errors).toEqual([]);
        expect(r2.errors).toEqual([]);
        expect(r1.ast).toBeDefined();
        expect(r2.ast).toBeDefined();

        expect(r1.ast!.leadingComments?.[0].text).toBe("// h1");
        expect(r2.ast!.leadingComments?.[0].text).toBe("// h1");
        expect(r1.ast!.body[0].leadingComments?.[0].text).toBe("// h2");
        expect(r2.ast!.body[0].leadingComments?.[0].text).toBe("// h2");

        // Array must not have been mutated.
        expect(comments.length).toBe(lenBefore);
        expect(JSON.stringify(comments)).toBe(snapshot);
    });
});

// ---------------------------------------------------------------------------
// 6. compile() API surface
// ---------------------------------------------------------------------------

describe("pass2: compile() API surface", () => {
    test("compile() does NOT expose an AST on the result (only ir + errors)", () => {
        const src = `// header
        workflow w(a: string): string {
            const x = a;
            return x;
        }`;
        const r = compile(src, []);
        expect(r.errors).toEqual([]);
        expect(r.ir).toBeDefined();
        // Documented shape: { ir?, errors }. No `ast` field.
        expect(Object.keys(r).sort()).toEqual(["errors", "ir"]);
        expect((r as unknown as { ast?: unknown }).ast).toBeUndefined();
    });

    test("compile() result's IR does not carry leadingComments or raw comment text", () => {
        const src = `// header
        workflow w(): string {
            /* note */
            return "x";
        }`;
        const r = compile(src, []);
        expect(r.errors).toEqual([]);
        const json = JSON.stringify(r.ir);
        expect(json).not.toContain("leadingComments");
        expect(json).not.toContain("// header");
        expect(json).not.toContain("/* note */");
    });
});
