// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseGrammarRules,
    expressionsSpecialChar,
} from "../src/grammarRuleParser.js";
import { writeGrammarRules } from "../src/grammarRuleWriter.js";
import { escapedSpaces, spaces } from "./testUtils.js";

// Parse src and write it back with given maxLineLength.
function fmt(src: string, maxLineLength?: number): string {
    return writeGrammarRules(
        parseGrammarRules("t", src, false),
        maxLineLength !== undefined ? { maxLineLength } : undefined,
    );
}

// Parse src, write it, re-parse, and check AST equality.
function roundTrip(src: string, maxLineLength?: number) {
    const orig = parseGrammarRules("orig", src, false);
    const written = writeGrammarRules(
        orig,
        maxLineLength !== undefined ? { maxLineLength } : undefined,
    );
    const reparsed = parseGrammarRules("reparsed", written, false);
    expect(reparsed).toStrictEqual(orig);
}

function validateRoundTrip(grammar: string) {
    const result = parseGrammarRules("orig", grammar, false);
    const str = writeGrammarRules(result);
    const parsedResult = parseGrammarRules("test", str, false);
    expect(parsedResult).toStrictEqual(result);
}

describe("Formatting layout", () => {
    describe("rule alternatives — flat vs broken", () => {
        it("single alt always flat", () => {
            // No alternates — always stays on one line
            expect(fmt("<test> = hello world;")).toBe(
                "<test> = hello world;\n",
            );
        });

        it("multi-alt stays flat when it fits", () => {
            // col=9, flatLen = 1+3+1+3+1 = 9, col+flatLen = 18 ≤ 20 → flat
            expect(fmt("<test> = a | b | c;", 20)).toBe(
                "<test> = a | b | c;\n",
            );
        });

        it("multi-alt fits exactly at limit", () => {
            // col=9, flatLen = 3+3+3+3+3 = 15, 9+15 = 24 ≤ 24 → flat
            expect(fmt("<test> = abc | def | ghi;", 24)).toBe(
                "<test> = abc | def | ghi;\n",
            );
        });

        it("multi-alt breaks one past the limit", () => {
            // 9+15 = 24 > 23 → broken; brokenCol=7, linePrefix="| "
            expect(fmt("<test> = abc | def | ghi;", 23)).toBe(
                "<test> = abc\n       | def\n       | ghi;\n",
            );
        });

        it("multi-alt broken with wider rule name", () => {
            // "<longer>" = 8, " = " = 3 → listStartCol = 11, col (brokenCol) = 9
            // flatLen = 3+3+3 = 9, listStartCol+flatLen = 11+9 = 20 > 19 → broken
            // brokenCol=9, prefix = "         | " (9 spaces)
            expect(fmt("<longer> = abc | def;", 19)).toBe(
                "<longer> = abc\n         | def;\n",
            );
        });

        it("broken alts round-trip", () => {
            roundTrip("<test> = abc | def | ghi;", 20);
        });
    });

    describe("arrow (->) placement — flat vs broken", () => {
        it("expression + value fits on one line", () => {
            // col=9 at list, GroupPart flat = "hello -> \"hi\"" = 13 chars
            // col+flatLen = 9+13 = 22 ≤ 22 → flat
            expect(fmt(`<test> = hello -> "hi";`, 22)).toBe(
                `<test> = hello -> "hi";\n`,
            );
        });

        it("arrow breaks to new line one past the limit", () => {
            // col+flatLen = 9+13 = 22 > 21 → broken GroupPart
            // arrowIndent = " ".repeat(7+2) + "-> " = "         -> " (12 chars)
            expect(fmt(`<test> = hello -> "hi";`, 21)).toBe(
                `<test> = hello\n         -> "hi";\n`,
            );
        });

        it("arrow broken — value still flat when it fits after ->", () => {
            // broken GroupPart: col after "         -> " = 12
            // value = { a: 1 } → flatLen = 2+2+4 = 8, col+flatLen = 12+8 = 20 ≤ 20
            expect(fmt(`<test> = hello -> { a: 1 };`, 20)).toBe(
                `<test> = hello\n         -> { a: 1 };\n`,
            );
        });

        it("arrow broken round-trip", () => {
            roundTrip(`<test> = hello -> "greeting";`, 21);
        });
    });

    describe("object {} — flat vs expanded", () => {
        it("object stays flat when it fits", () => {
            // broken GroupPart → col=12 after "         -> "
            // flatLen({ a: 1, b: 2 }) = 2+"a: 1"+2+"b: 2"+2 = 2+4+2+4+2 = 14
            // col+flatLen = 12+14 = 26 ≤ 26 → flat
            expect(fmt(`<test> = x -> { a: 1, b: 2 };`, 26)).toBe(
                `<test> = x\n         -> { a: 1, b: 2 };\n`,
            );
        });

        it("object expands when flat form overflows", () => {
            // col+flatLen = 12+14 = 26 > 25 → expanded
            // blockCol=12, entryCol=14; 14 spaces before entries, 12 before }
            expect(fmt(`<test> = x -> { a: 1, b: 2 };`, 25)).toBe(
                `<test> = x\n         -> {\n              a: 1,\n              b: 2\n            };\n`,
            );
        });

        it("empty object always flat", () => {
            expect(fmt(`<test> = x -> {};`)).toBe(`<test> = x -> {};\n`);
        });

        it("shorthand key (no value) written without colon", () => {
            // { items } is shorthand; variable value node with val=null
            expect(fmt(`<test> = $(x) -> { x };`)).toBe(
                `<test> = $(x) -> { x };\n`,
            );
        });

        it("nested object — inner expands when outer already expanded", () => {
            // outer expanded → entries at entryCol=14
            // inner object { c: 3 } starts at col=14+"b: " = 14+3 = 17
            // flatLen({ c: 3 }) = 2+4+2 = 8, 17+8 = 25 ≤ 25 → inner stays flat
            expect(fmt(`<test> = x -> { a: 1, b: { c: 3 } };`, 25)).toBe(
                `<test> = x\n         -> {\n              a: 1,\n              b: { c: 3 }\n            };\n`,
            );
        });

        it("object expanded round-trip", () => {
            roundTrip(`<test> = x -> { a: 1, b: 2 };`, 25);
        });
    });

    describe("array [] — flat vs expanded", () => {
        it("array stays flat when it fits", () => {
            // broken GroupPart → col=12 after "         -> "
            // flatLen([1, 2, 3]) = 1+1+2+1+2+1 = 9 ("["+"1"+", "+"2"+", "+"3"+"]")
            // col+flatLen = 12+9 = 21 ≤ 21 → flat
            expect(fmt(`<test> = x -> [1, 2, 3];`, 21)).toBe(
                `<test> = x\n         -> [1, 2, 3];\n`,
            );
        });

        it("array expands when flat form overflows", () => {
            // col+flatLen = 12+9 = 21 > 20 → expanded
            // blockCol=12, entryCol=14
            expect(fmt(`<test> = x -> [1, 2, 3];`, 20)).toBe(
                `<test> = x\n         -> [\n              1,\n              2,\n              3\n            ];\n`,
            );
        });

        it("empty array always flat", () => {
            expect(fmt(`<test> = x -> [];`)).toBe(`<test> = x -> [];\n`);
        });

        it("array with nested object — whole array stays flat after -> breaks", () => {
            // GroupPart flat = "x -> [{ a: 1 }]" = 15 chars, col=9, 9+15=24 > 23 → broken
            // In broken form, array starts at col=12; flatLen([{ a: 1 }]) = 10, 12+10=22 ≤ 23
            // → array (and its inner object) stays on one line
            expect(fmt(`<test> = x -> [{ a: 1 }];`, 23)).toBe(
                `<test> = x\n         -> [{ a: 1 }];\n`,
            );
        });

        it("array expanded round-trip", () => {
            roundTrip(`<test> = x -> [1, 2, 3];`, 20);
        });
    });

    describe("expression sequence wrapping", () => {
        it("short variable sequence fits — no wrapping", () => {
            // col=9; $(a)(4)+" "+(4)+" "+(4) = 9+4+1+4+1+4 = 23 ≤ 23 → flat
            expect(fmt("<test> = $(a) $(b) $(c);", 23)).toBe(
                "<test> = $(a) $(b) $(c);\n",
            );
        });

        it("variable sequence wraps between Expr elements", () => {
            // col=9; $(a)→col=13; check $(b)(4): 13+1+4=18 > 15 → wrap
            // continuationCol = indent(7) + 2 + indentSize(2) = 11
            expect(fmt("<test> = $(a) $(b) $(c);", 15)).toBe(
                "<test> = $(a)\n           $(b)\n           $(c);\n",
            );
        });

        it("variable sequence wrapping round-trips", () => {
            roundTrip("<test> = $(a) $(b) $(c);", 15);
        });

        it("long string token wraps at word boundaries", () => {
            // Parsed as single string Expr with words [hello,world,foo,bar,baz]
            // col=9; "hello"→14; "world"(5): 14+1+5=20 ≤ 20→space→col=20
            // "foo"(3): 20+1+3=24 > 20 → wrap→col=11; "bar"(3): 11+3+1+3=18→space
            // "baz"(3): 14+1+3=18 ≤ 20→wait, 18 ≤ 20→space→col=19... let me recalc:
            // after "foo" col=14; "bar"(3): 14+1+3=18 ≤ 20→space→col=15, "bar"→col=18
            // "baz"(3): 18+1+3=22 > 20 → wrap→col=11, "baz"→col=14
            expect(fmt("<test> = hello world foo bar baz;", 20)).toBe(
                "<test> = hello world\n           foo bar\n           baz;\n",
            );
        });

        it("long string token wrapping round-trips", () => {
            roundTrip("<test> = hello world foo bar baz;", 20);
        });

        it("string token fits on one line — no wrapping", () => {
            // col=9; "hello world"=11; 9+11=20 ≤ 20 → no wrap
            expect(fmt("<test> = hello world;", 20)).toBe(
                "<test> = hello world;\n",
            );
        });
    });

    describe("inline expression group — flat vs broken", () => {
        it("inline group stays flat when it fits", () => {
            // After "(", col=10; inner ListPart flatLen=1+3+1+3+1=9, 10+9=19 ≤ 19 → flat
            expect(fmt("<test> = (a | b | c)?;", 19)).toBe(
                "<test> = (a | b | c)?;\n",
            );
        });

        it("inline group breaks with | aligned to (", () => {
            // 10+9=19 > 18 → broken; brokenCol = col+(-1) = 10-1 = 9
            // prefix = "         | " (9 spaces + "| ")
            expect(fmt("<test> = (a | b | c)?;", 18)).toBe(
                "<test> = (a\n         | b\n         | c)?;\n",
            );
        });

        it("inline group broken round-trip", () => {
            roundTrip("<test> = (a | b | c)?;", 18);
        });
    });
});

describe("Grammar Rule Writer", () => {
    it("simple", () => {
        validateRoundTrip(`<test> = hello world;`);
    });
    it("alternates", () => {
        validateRoundTrip(`<test> = hello | world | again;`);
    });
    it("multiple rules", () => {
        validateRoundTrip(`
            <test> = hello | world | again;
            <other> = one two three;
        `);
    });
    it("rule reference", () => {
        validateRoundTrip(`
            <test> = hello <other> world;
            <other> = one two three;
        `);
    });
    it("optional rule reference", () => {
        validateRoundTrip(`
            <test> = hello (<other>)? world;
            <other> = one | two | three;
        `);
    });
    it("kleene star group", () => {
        validateRoundTrip(`<test> = hello (world)* end;`);
    });
    it("kleene plus group", () => {
        validateRoundTrip(`<test> = hello (world)+ end;`);
    });
    it("kleene star with alternates", () => {
        validateRoundTrip(`<test> = hello (world | earth)* end;`);
    });
    it("spaces in expressions", () => {
        validateRoundTrip(
            `<test> = ${spaces}${escapedSpaces}${spaces}${escapedSpaces}${spaces};`,
        );
    });
    it("special characters in expressions", () => {
        validateRoundTrip(
            `<test> = ${expressionsSpecialChar.map((c) => `\\${c}`).join("")};`,
        );
    });
    it("with string value", () => {
        validateRoundTrip(`<test> = hello -> "greeting";`);
    });

    it("with boolean value", () => {
        validateRoundTrip(`<test> = hello -> true;`);
    });
    it("with number value", () => {
        validateRoundTrip(`<test> = hello -> -12.3e+2;`);
    });

    it("with object value", () => {
        validateRoundTrip(`<test> = hello -> { b: true, n: 12, s: "string" };`);
    });
    it("with object spread value", () => {
        validateRoundTrip(
            `<test> = hello $(x:<other>) -> { ...x, extra: 1 };\n<other> = world -> { a: 2 };`,
        );
    });
    it("with object spread only", () => {
        validateRoundTrip(
            `<test> = hello $(x:<other>) -> { ...x };\n<other> = world -> { a: 2 };`,
        );
    });
    it("with array value", () => {
        validateRoundTrip(`<test> = hello -> [true, 34.3, "string"];`);
    });
    it("with nested value", () => {
        validateRoundTrip(
            `<test> = hello -> { b: true, n: 12, s: "string", a: [1, 2, { o: "z" }], o: { x: [] } };`,
        );
    });
    it("with variable", () => {
        validateRoundTrip(
            `<test> = hello $(x) world -> { "type": "test", "var": x };`,
        );
    });
    it("with number variable", () => {
        validateRoundTrip(
            `<test> = hello $(x: number) world -> { "type": "test", "var": x };`,
        );
    });
    it("with rules reference variable", () => {
        validateRoundTrip(`<test> = hello $(x:<other>) world -> { "type": "test", "var": x };
            <other> = one -> 1 | two ->2 | three -> 3;`);
    });
    it("with optional variable", () => {
        validateRoundTrip(
            `<test> = hello $(x: number)? world -> { "type": "test", "var": x };`,
        );
    });
    it("with wildcard import", () => {
        validateRoundTrip(`import * from "someGrammar";
<test> = hello world;`);
    });
    it("with named imports", () => {
        validateRoundTrip(`import { RuleA, RuleB } from "someGrammar";
<test> = hello world;`);
    });
    it("with multiple imports", () => {
        validateRoundTrip(`import * from "grammarA";
import { RuleX } from "grammarB";
<test> = hello world;`);
    });
    it("with spacing=required annotation", () => {
        validateRoundTrip(`<test> [spacing=required] = hello world;`);
    });
    it("with spacing=optional annotation", () => {
        validateRoundTrip(`<test> [spacing=optional] = hello world;`);
    });
    it("with spacing=none annotation", () => {
        validateRoundTrip(`<test> [spacing=none] = hello world;`);
    });
    it("with spacing=auto annotation (preserved by writer)", () => {
        // Explicit [spacing=auto] annotation is stored as "auto" and round-trips.
        const result = parseGrammarRules(
            "orig",
            `<test> [spacing=auto] = hello world;`,
            false,
        );
        expect(result.definitions[0].spacingMode).toBe("auto");
        expect(writeGrammarRules(result)).toBe(
            "<test> [spacing=auto] = hello world;\n",
        );
    });
    it("per-rule annotations — mixed modes", () => {
        validateRoundTrip(`<before> = one two;
<after> [spacing=required] = hello world;`);
    });
    it("multiple rules with different annotations", () => {
        validateRoundTrip(`<rule1> [spacing=required] = hello world;
<rule2> [spacing=optional] = hello world;`);
    });
    it("annotation then unannotated rule (auto default)", () => {
        validateRoundTrip(`<rule1> [spacing=required] = hello world;
<rule2> = hello world;`);
    });
    it("with value type annotation", () => {
        validateRoundTrip(`<test> : MyType = hello world;`);
    });
    it("with value type and spacing annotation", () => {
        validateRoundTrip(`<test> [spacing=required] : MyType = hello world;`);
    });
    it("with value type and value expression", () => {
        validateRoundTrip(
            `<test> : MyType = hello $(x:number) -> { actionName: "greet", x };`,
        );
    });
    it("with export and value type", () => {
        validateRoundTrip(`export <test> : MyType = hello world;`);
    });
    it("with export, spacing, and value type", () => {
        validateRoundTrip(
            `export <test> [spacing=required] : MyType = hello world;`,
        );
    });
    it("with union value type", () => {
        validateRoundTrip(`<test> : TypeA | TypeB = hello world;`);
    });
    it("with three-way union value type", () => {
        validateRoundTrip(`<test> : A | B | C = hello world;`);
    });
    it("with union value type and spacing", () => {
        validateRoundTrip(`<test> [spacing=required] : A | B = hello world;`);
    });
    it("with export and union value type", () => {
        validateRoundTrip(`export <test> : A | B | C = hello world;`);
    });
});

// ─── Comment preservation round-trips ─────────────────────────────────────────

describe("Comment preservation", () => {
    it("file-level leading line comment (copyright header)", () => {
        roundTrip(`// Copyright (c) Foo.
// Licensed under MIT.

<A> = x;
`);
    });

    it("line comment before rule definition", () => {
        roundTrip(`// a rule
<A> = x;
`);
    });

    it("trailing line comment after rule definition", () => {
        roundTrip(`<A> = x; // trailing
`);
    });

    it("line comment before second alternative", () => {
        roundTrip(`<A> = x
// second alt
| y;
`);
    });

    it("block comment as leading comment before rule", () => {
        roundTrip(`/* block comment */
<A> = x;
`);
    });

    it("trailing block comment after rule", () => {
        roundTrip(`<A> = x; /* block trailing */
`);
    });

    it("line comment between words in expression", () => {
        roundTrip(`<A> = hello // mid-expr comment
world;
`);
    });

    it("block comment between words in expression", () => {
        roundTrip(`<A> = hello /* mid */ world;
`);
    });

    it("comment between variable and rule ref in expression", () => {
        roundTrip(`<A> = $(x:wildcard) // note
<B>;
<B> = foo;
`);
    });

    it("line comment after import with trailing comment", () => {
        roundTrip(`// section
import * from "other.agr"; // imp comment
<A> = x;
`);
    });

    it("source-less import with leading and trailing comments", () => {
        roundTrip(`// entities
import { Foo, Bar }; // the entities
<A> = x;
`);
    });

    it("combination: file header + per-rule + per-alt comments", () => {
        roundTrip(`// Header

// Rule A
<A> = // first alt
x
// second alt
| y;
// Rule B
<B> = z;
`);
    });

    it("// and /* */ styles are both preserved and not conflated", () => {
        const src = `// line comment
<A> = hello /* block */ world;
`;
        const parsed = parseGrammarRules("t", src, false);
        expect(parsed.leadingComments).toEqual([
            { style: "line", text: " line comment" },
        ]);
        const exprs = parsed.definitions[0].rules[0].expressions;
        // The block comment is now a leadingComment on the following expr.
        const worldExpr = exprs.find(
            (e) => e.type === "string" && e.value[0] === "world",
        );
        expect(worldExpr?.leadingComments).toEqual([
            { style: "block", text: " block " },
        ]);
        roundTrip(src);
    });

    it("comments at end of file are preserved", () => {
        roundTrip(`<A> = x;
// end of file comment
`);
    });

    it("multiple comments at end of file are preserved", () => {
        roundTrip(`<A> = x;
// first trailing
// second trailing
`);
    });

    it("line comment right after -> is preserved (valueLeadingComments)", () => {
        const src = `<A> = foo -> // leading comment
   { actionName: "bar" };
`;
        const parsed = parseGrammarRules("t", src, false);
        expect(parsed.definitions[0].rules[0].valueLeadingComments).toEqual([
            { style: "line", text: " leading comment" },
        ]);
        roundTrip(src);
    });

    it("block comment right after -> is preserved inline", () => {
        roundTrip(`<A> = foo -> /* note */ { actionName: "bar" };
`);
    });

    it("line comment after value (before |) is preserved as valueTrailingComments", () => {
        const src = `<A> = foo -> { actionName: "bar" } // trailing comment
| baz -> { actionName: "qux" };
`;
        const parsed = parseGrammarRules("t", src, false);
        expect(parsed.definitions[0].rules[0].valueTrailingComments).toEqual([
            { style: "line", text: " trailing comment" },
        ]);
        roundTrip(src);
    });

    it("trailing line comment stays flat (-> inline) and causes no blank line before |", () => {
        // The trailing // comment must not force the group into broken mode (-> on
        // its own line) nor produce a blank line before the next alternative.
        // BreakPart makes the list break at | without adding an extra newline.
        // Note: // ends the line, so | must be on the next line in the source.
        const src = `<Pause> = pause -> { actionName: "pause" }// c
| pause music -> { actionName: "pause" };`;
        // <Pause> = 10 chars → col=8; flat group "pause -> ...// c" = 36 chars → 10+36=46 ≤ 80 → flat
        expect(fmt(src)).toBe(
            `<Pause> = pause -> { actionName: "pause" } // c\n        | pause music -> { actionName: "pause" };\n`,
        );
        roundTrip(src);
    });

    it("block comment between rule name and = is preserved (beforeEqualsComments)", () => {
        roundTrip(`<A> /* blah */ = x;
`);
    });

    it("line comment between rule name and = is preserved (beforeEqualsComments)", () => {
        roundTrip(`<A> // blah
= x;
`);
    });

    it("block comment between annotation and = is preserved (beforeEqualsComments)", () => {
        roundTrip(`<A> [spacing=required] /* blah */ = x;
`);
    });

    it("block comment between rule name and annotation is preserved (beforeAnnotationComments)", () => {
        roundTrip(`<A> /* before */ [spacing=required] = x;
`);
    });

    it("comments both before and after annotation are preserved", () => {
        roundTrip(`<A> /* before */ [spacing=required] /* after */ = x;
`);
    });

    it("block comment after value (before |) is preserved as valueTrailingComments", () => {
        roundTrip(`<A> = foo -> { actionName: "bar" } /* note */ | baz -> { actionName: "qux" };
`);
    });

    it("combination: value leading + trailing comments", () => {
        roundTrip(`<A> = foo -> // before value
   { actionName: "bar" } // after value
| baz;
`);
    });

    // ── Value node comments (leadingComments / trailingComments on ValueNode) ──

    it("block comment after ':' on object property value is preserved", () => {
        roundTrip(`<A> = foo -> { type: /* before */ "greeting" };
`);
    });

    it("line comment after ':' on object property value is preserved", () => {
        roundTrip(`<A> = foo -> {
   type: // before
   "greeting"
};
`);
    });

    it("trailing block comment on object property value is preserved", () => {
        roundTrip(`<A> = foo -> { type: "greeting" /* after */ };
`);
    });

    it("trailing line comment on object property value is preserved", () => {
        roundTrip(`<A> = foo -> {
   count: 1 // after
};
`);
    });

    it("block comment after '[' on first array element is preserved", () => {
        roundTrip(`<A> = foo -> [/* first */ "a", "b"];
`);
    });

    it("block comment after ',' on subsequent array element is preserved", () => {
        roundTrip(`<A> = foo -> ["a", /* second */ "b"];
`);
    });

    it("line comment between ',' and next array element is preserved as leadingComments", () => {
        // "a", // comment → comment becomes leadingComments on "b"
        roundTrip(`<A> = foo -> [
   "a", // first
   "b"
];
`);
    });

    it("block comment before ',' on array element is preserved as trailingComments", () => {
        roundTrip(`<A> = foo -> ["a" /* trailing */, "b"];
`);
    });

    // ── Array element trailing comments ────────────────────────────────────────

    it("/* */ comment after ',' is leading on next element (not trailing on previous)", () => {
        roundTrip(`<A> = foo -> ["a", /* note */ "b"];
`);
    });

    it("// comment after ',' is preserved as trailingComment on that element", () => {
        roundTrip(`<A> = foo -> [
   "a", // note
   "b"
];
`);
    });

    it("trailingComment and leadingComments on next element coexist correctly", () => {
        roundTrip(`<A> = foo -> [
   "a", // trailing
   /* leading */ "b"
];
`);
    });

    it("/* */ after comma stays flat when it fits as leading comment", () => {
        // Block comment after comma is now leading on next element, not trailing.
        // No itemTrailingText → flat mode is possible.
        const once = fmt(`<A> = foo -> [\n  "a", /* note */ "b"\n];\n`);
        expect(once).toBe(`<A> = foo -> ["a", /* note */ "b"];\n`);
        expect(fmt(once)).toBe(once); // idempotent
    });

    it("/* */ trailing comment round-trips", () => {
        roundTrip(`<A> = foo -> ["a", /* note */ "b"];
`);
    });

    // ── Trailing comma and closingComments ────────────────────────────────────────

    it("trailing comma with block innerComment round-trips in broken mode (array)", () => {
        roundTrip(`<A> = foo -> [
   "a",
   /* footer */
];
`);
    });

    it("trailing comma with line innerComment round-trips in broken mode (array)", () => {
        roundTrip(`<A> = foo -> [
   "a",
   // footer
];
`);
    });

    it("trailing comma with block innerComment round-trips in broken mode (object)", () => {
        roundTrip(`<A> = foo -> {
   type: "greeting",
   /* footer */
};
`);
    });

    it("innerComment in empty array round-trips", () => {
        roundTrip(`<A> = foo -> [
   /* empty */
];
`);
    });

    it("innerComment in empty object round-trips", () => {
        roundTrip(`<A> = foo -> {
   /* empty */
};
`);
    });

    it("trailing comment on last item + closingComment round-trips (object)", () => {
        roundTrip(`<A> = foo -> {
   type: "greeting", /*trailing*/
   /* closing */
};
`);
    });

    it("trailing comment on last item + closingComment round-trips (array)", () => {
        roundTrip(`<A> = foo -> [
   "a", /*trailing*/
   /* closing */
];
`);
    });

    it("line trailing comment on last item + closingComment round-trips (object)", () => {
        roundTrip(`<A> = foo -> {
   type: "greeting", // trailing
   /* closing */
};
`);
    });

    it("line trailing comment on last item + closingComment round-trips (array)", () => {
        roundTrip(`<A> = foo -> [
   "a", // trailing
   /* closing */
];
`);
    });

    // ── Object property key leading comments ───────────────────────────────────

    it("block comment before first property key is preserved", () => {
        roundTrip(`<A> = foo -> { /* first */ type: "greeting" };
`);
    });

    it("block comment on same line as comma becomes leadingComment on next property", () => {
        roundTrip(`<A> = foo -> { type: "greeting", /* second */ count: 1 };
`);
    });

    it("line comment before first property key is preserved", () => {
        roundTrip(`<A> = foo -> {
   // first prop
   type: "greeting"
};
`);
    });

    it("line comment before subsequent property key is preserved", () => {
        roundTrip(`<A> = foo -> {
   type: "greeting",
   // second prop
   count: 1
};
`);
    });

    it("block comment before shorthand property key is preserved", () => {
        roundTrip(`<A> = $(x) foo -> { /* before */ x };
`);
    });

    it("// line comment after comma is preserved as trailingComment on that property", () => {
        roundTrip(`<A> = foo -> {
   type: "greeting", // note
   count: 1
};
`);
    });

    it("// trailing and /* */ leading are both preserved and round-trip correctly", () => {
        roundTrip(`<A> = foo -> {
   type: "greeting", // trailing
   /* leading */ count: 1
};
`);
    });

    it("/* */ leading comment on subsequent key stays inline when object fits flat", () => {
        expect(
            fmt(
                `<A> = foo -> {\n  key: blah,\n  /* leading */ key2: blah2\n};\n`,
            ),
        ).toBe(`<A> = foo -> { key: blah, /* leading */ key2: blah2 };\n`);
    });

    it("/* */ leading comment on subsequent key round-trips through flat form", () => {
        roundTrip(`<A> = foo -> { key: blah, /* leading */ key2: blah2 };\n`);
    });

    it("block trailing and block leading comments coexist on separate lines (object)", () => {
        // Multi-line form: /*trailing*/ is at end of line → trailing on k.
        // /*leading*/ is on the next line → leading on k2.
        const multiLine = `<A> = foo -> {
   k: v, /*trailing*/
   /*leading*/ k2: v2
};
`;
        const parsed = parseGrammarRules("test", multiLine, false);
        const props = parsed.definitions[0].rules[0].value!;
        expect(props.type).toBe("object");
        const objProps = (props as any).value;
        // Block comment at end of line → trailing on first prop
        expect(objProps[0].trailingComments).toEqual([
            { style: "block", text: "trailing" },
        ]);
        // Block comment on next line → leading on second prop
        expect(objProps[1].leadingComments).toEqual([
            { style: "block", text: "leading" },
        ]);
    });

    it("block trailing and block leading comments round-trip (object)", () => {
        // Writer must keep broken mode so the parser can distinguish trailing
        // comments (after ",") from leading comments (before next key).
        roundTrip(`<A> = foo -> {
   k: v, /*trailing*/
   /*leading*/ k2: v2
};
`);
    });

    it("block trailing and block leading comments round-trip (array)", () => {
        // Same for array elements
        roundTrip(`<A> = foo -> [
   "a", /*trailing*/
   /*leading*/ "b"
];
`);
    });
});

// ─── Source-less import and import block formatting ──────────────────────────

describe("Source-less import block formatting", () => {
    it("short import list stays flat", () => {
        expect(fmt("import { Foo, Bar };", 40)).toBe(
            "import { Foo, Bar };\n\n",
        );
    });

    it("single import stays flat", () => {
        expect(fmt("import { Foo };", 40)).toBe("import { Foo };\n\n");
    });

    it("long import list breaks into block", () => {
        expect(
            fmt("import { VeryLongName, AnotherLongName, YetAnother };", 30),
        ).toBe(
            "import {\n  VeryLongName,\n  AnotherLongName,\n  YetAnother\n};\n\n",
        );
    });

    it("source-less import block round-trips", () => {
        roundTrip(
            "import { VeryLongEntityName, AnotherLongEntityName, ThirdEntity };",
            30,
        );
    });

    it("source-less import block with trailing comment", () => {
        expect(
            fmt("import { VeryLongName, AnotherLongName }; // note", 30),
        ).toBe("import {\n  VeryLongName,\n  AnotherLongName\n}; // note\n\n");
    });

    it("source-less import block with trailing comment round-trips", () => {
        roundTrip("import { VeryLongName, AnotherLongName }; // note", 30);
    });

    it("source-less import block with block comments on names", () => {
        roundTrip(
            "import { /* a */ VeryLongName /* b */, /* c */ AnotherLong /* d */ };",
            30,
        );
    });

    it("multi-line source-less import round-trips", () => {
        roundTrip(
            `import {
  Foo,
  Bar,
  Baz,
};
<A> = x;
`,
            80,
        );
    });
});

describe("Import block formatting", () => {
    it("short import list stays flat", () => {
        expect(fmt('import { A, B } from "file";', 40)).toBe(
            'import { A, B } from "file";\n\n',
        );
    });

    it("single import stays flat", () => {
        expect(fmt('import { Name } from "file";', 40)).toBe(
            'import { Name } from "file";\n\n',
        );
    });

    it("long import list breaks into block", () => {
        expect(
            fmt(
                'import { VeryLongRuleName, AnotherLongRule, ThirdRule } from "file";',
                40,
            ),
        ).toBe(
            'import {\n  VeryLongRuleName,\n  AnotherLongRule,\n  ThirdRule\n} from "file";\n\n',
        );
    });

    it("import block round-trips", () => {
        roundTrip(
            'import { VeryLongRuleName, AnotherLongRule, ThirdRule } from "file";',
            40,
        );
    });

    it("wildcard import unaffected by maxLineLength", () => {
        expect(fmt('import * from "file";', 10)).toBe(
            'import * from "file";\n\n',
        );
    });

    it("import block with block comments on names", () => {
        roundTrip(
            'import { /* a */ VeryLongName /* b */, /* c */ AnotherLong /* d */ } from "file";',
            30,
        );
    });

    it("import block with afterCloseBrace comment", () => {
        roundTrip(
            'import { VeryLongName, AnotherLong } /* note */ from "file";',
            30,
        );
    });

    it("multi-line import input round-trips", () => {
        roundTrip(
            `import {
  RuleA,
  RuleB,
  RuleC
} from "file";
<A> = x;
`,
            80,
        );
    });
});

describe("Flat-line comment positions → broken-mode output", () => {
    // These tests verify that comments written on a single flat line are parsed
    // into the correct AST position (leading/trailing/after-comma/closing) so
    // that when the formatter re-emits in broken mode, each comment appears
    // exactly where it should.

    // ── Array ─────────────────────────────────────────────────────────────────

    it("array: leading comment before first element", () => {
        const src = `<A> = foo -> [/*L*/ "a", "b"];\n`;
        const parsed = parseGrammarRules("test", src, false);
        const arr = parsed.definitions[0].rules[0].value!;
        expect(arr.type).toBe("array");
        const elems = (arr as any).value;
        expect(elems[0].value.leadingComments).toEqual([
            { style: "block", text: "L" },
        ]);
        expect(elems[1].value.leadingComments).toBeUndefined();
        roundTrip(src);
    });

    it("array: trailing comment after value (before comma)", () => {
        const src = `<A> = foo -> ["a" /*T*/, "b"];\n`;
        const parsed = parseGrammarRules("test", src, false);
        const elems = (parsed.definitions[0].rules[0].value as any).value;
        expect(elems[0].value.trailingComments).toEqual([
            { style: "block", text: "T" },
        ]);
        expect(elems[0].trailingComments).toBeUndefined();
        roundTrip(src);
    });

    it("array: comment after comma becomes next element's leadingComments", () => {
        const src = `<A> = foo -> ["a", /*C*/ "b"];\n`;
        const parsed = parseGrammarRules("test", src, false);
        const elems = (parsed.definitions[0].rules[0].value as any).value;
        // Block comment after comma → leadingComments on element[1]'s value
        expect(elems[0].trailingComments).toBeUndefined();
        expect(elems[1].value.leadingComments).toEqual([
            { style: "block", text: "C" },
        ]);
        roundTrip(src);
    });

    it("array: trailing comment after last value (before ])", () => {
        const src = `<A> = foo -> ["a", "b" /*T*/];\n`;
        const parsed = parseGrammarRules("test", src, false);
        const elems = (parsed.definitions[0].rules[0].value as any).value;
        expect(elems[1].value.trailingComments).toEqual([
            { style: "block", text: "T" },
        ]);
        roundTrip(src);
    });

    it("array: all four positions produce correct output", () => {
        // /*A*/ → elem[0].value.leadingComments (before value)
        // /*B*/ → elem[0].value.trailingComments (after value, before comma)
        // /*C*/ → elem[1].value.leadingComments (after comma, block → leading)
        // /*D*/ → elem[1].value.trailingComments (after last value)
        const flat = `<A> = foo -> [/*A*/ "a" /*B*/, /*C*/ "b" /*D*/];\n`;
        const broken = fmt(flat);
        // Comments force broken mode only via value comments (line comments)
        // or closingLines; block comments after commas are now leading and
        // don't force broken mode by themselves.
        expect(broken).toContain(`/*A*/ "a" /*B*/`);
        expect(broken).toContain(`/*C*/ "b" /*D*/`);
        expect(fmt(broken)).toBe(broken); // idempotent
        roundTrip(flat);
    });

    // ── Object ────────────────────────────────────────────────────────────────

    it("object: leading comment before first property key", () => {
        const src = `<A> = foo -> { /*L*/ k: v, k2: v2 };\n`;
        const parsed = parseGrammarRules("test", src, false);
        const props = (parsed.definitions[0].rules[0].value as any).value;
        expect(props[0].leadingComments).toEqual([
            { style: "block", text: "L" },
        ]);
        expect(props[1].leadingComments).toBeUndefined();
        roundTrip(src);
    });

    it("object: trailing comment after property value (before comma)", () => {
        const src = `<A> = foo -> { k: v /*T*/, k2: v2 };\n`;
        const parsed = parseGrammarRules("test", src, false);
        const props = (parsed.definitions[0].rules[0].value as any).value;
        expect(props[0].value.trailingComments).toEqual([
            { style: "block", text: "T" },
        ]);
        expect(props[0].trailingComments).toBeUndefined();
        roundTrip(src);
    });

    it("object: comment after comma becomes next property's leadingComments", () => {
        const src = `<A> = foo -> { k: v, /*C*/ k2: v2 };\n`;
        const parsed = parseGrammarRules("test", src, false);
        const props = (parsed.definitions[0].rules[0].value as any).value;
        // Block comment after comma → leadingComments on next property
        expect(props[0].trailingComments).toBeUndefined();
        expect(props[1].leadingComments).toEqual([
            { style: "block", text: "C" },
        ]);
        roundTrip(src);
    });

    it("object: trailing comment after last property value (before })", () => {
        const src = `<A> = foo -> { k: v, k2: v2 /*T*/ };\n`;
        const parsed = parseGrammarRules("test", src, false);
        const props = (parsed.definitions[0].rules[0].value as any).value;
        expect(props[1].value.trailingComments).toEqual([
            { style: "block", text: "T" },
        ]);
        roundTrip(src);
    });

    it("object: all four positions produce correct output", () => {
        const flat = `<A> = foo -> { /*A*/ k: v /*B*/, /*C*/ k2: v2 /*D*/ };\n`;
        const broken = fmt(flat);
        expect(broken).toContain(`/*A*/ k: v /*B*/`);
        expect(broken).toContain(`/*C*/ k2: v2 /*D*/`);
        expect(fmt(broken)).toBe(broken); // idempotent
        roundTrip(flat);
    });

    // ── Same-line vs next-line: after-comma position depends on line break ────

    it("array: block comment after comma at EOL is trailing; inline is leading", () => {
        // Same line, followed by more content → leading on element[1]
        const flat = `<A> = foo -> ["a", /*C*/ "b"];\n`;
        const flatParsed = parseGrammarRules("flt", flat, false);
        const flatElems = (flatParsed.definitions[0].rules[0].value as any)
            .value;
        expect(flatElems[0].trailingComments).toBeUndefined();
        expect(flatElems[1].value.leadingComments).toEqual([
            { style: "block", text: "C" },
        ]);

        // At end of line (newline follows) → trailing on element[0]
        const eol = `<A> = foo -> [\n  "a", /*C*/\n  "b"\n];\n`;
        const eolParsed = parseGrammarRules("eol", eol, false);
        const eolElems = (eolParsed.definitions[0].rules[0].value as any).value;
        expect(eolElems[0].trailingComments).toEqual([
            { style: "block", text: "C" },
        ]);
        expect(eolElems[1].value.leadingComments).toBeUndefined();

        // Next line (no content after comma) → leading on element[1]
        const multi = `<A> = foo -> [\n  "a",\n  /*C*/ "b"\n];\n`;
        const multiParsed = parseGrammarRules("multi", multi, false);
        const multiElems = (multiParsed.definitions[0].rules[0].value as any)
            .value;
        expect(multiElems[0].trailingComments).toBeUndefined();
        expect(multiElems[1].value.leadingComments).toEqual([
            { style: "block", text: "C" },
        ]);
    });

    it("object: block comment after comma at EOL is trailing; inline is leading", () => {
        // Same line, followed by more content → leading on prop[1]
        const flat = `<A> = foo -> { k: v, /*C*/ k2: v2 };\n`;
        const flatParsed = parseGrammarRules("flt", flat, false);
        const flatProps = (flatParsed.definitions[0].rules[0].value as any)
            .value;
        expect(flatProps[0].trailingComments).toBeUndefined();
        expect(flatProps[1].leadingComments).toEqual([
            { style: "block", text: "C" },
        ]);

        // At end of line → trailing on prop[0]
        const eol = `<A> = foo -> {\n  k: v, /*C*/\n  k2: v2\n};\n`;
        const eolParsed = parseGrammarRules("eol", eol, false);
        const eolProps = (eolParsed.definitions[0].rules[0].value as any).value;
        expect(eolProps[0].trailingComments).toEqual([
            { style: "block", text: "C" },
        ]);
        expect(eolProps[1].leadingComments).toBeUndefined();

        // Next line → leading on prop[1]
        const multi = `<A> = foo -> {\n  k: v,\n  /*C*/ k2: v2\n};\n`;
        const multiParsed = parseGrammarRules("multi", multi, false);
        const multiProps = (multiParsed.definitions[0].rules[0].value as any)
            .value;
        expect(multiProps[0].trailingComments).toBeUndefined();
        expect(multiProps[1].leadingComments).toEqual([
            { style: "block", text: "C" },
        ]);
    });

    it("array: // line comment after comma is still trailing", () => {
        const src = `<A> = foo -> [\n  "a", // line\n  "b"\n];\n`;
        const parsed = parseGrammarRules("test", src, false);
        const elems = (parsed.definitions[0].rules[0].value as any).value;
        expect(elems[0].trailingComments).toEqual([
            { style: "line", text: " line" },
        ]);
        expect(elems[1].value.leadingComments).toBeUndefined();
    });
});

describe("Comment preservation round-trips (structural positions)", () => {
    it("block comment inside rule name angle brackets", () => {
        roundTrip(`</*A*/Rule/*B*/> = hello;\n`);
    });

    it("block comments in [spacing=...] annotation", () => {
        roundTrip(`<Rule> [/*a*/spacing/*b*/=/*c*/required/*d*/] = hello;\n`);
    });

    it("spacing=auto round-trips with explicit annotation", () => {
        roundTrip(`<Rule> [spacing=auto] = hello;\n`);
    });

    it("per-alternate [spacing=...] round-trips", () => {
        roundTrip(`<Rule> = hello | [spacing=none] world;\n`);
    });

    it("per-alternate [spacing=auto] round-trips", () => {
        roundTrip(`<Rule> = hello | [spacing=auto] world;\n`);
    });

    it("block comment before per-alternate [spacing=...] is preserved", () => {
        roundTrip(`<Rule> = hello | /* before */ [spacing=none] world;\n`);
    });

    it("block comment between $( and variable name", () => {
        roundTrip(`<Rule> = $(/*c*/x);\n`);
    });

    it("block comment after colon in variable specifier", () => {
        roundTrip(`<Rule> = $(x:/*c*/string);\n`);
    });

    it("block comment inside rule reference angle brackets in variable type", () => {
        roundTrip(`<Rule> = $(x:</*a*/Inner/*b*/>);\n`);
    });

    it("block comment inside inline rule reference angle brackets", () => {
        roundTrip(`<Rule> = </*a*/Other/*b*/>;\n`);
    });

    it("block comments inside import braces (leading and trailing per name)", () => {
        roundTrip(
            `import { /* A */ Name1 /* B */, /* C */ Name2 /* D */ } from "file.agr";\n`,
        );
    });

    it("block comment after 'import' keyword and after closing brace", () => {
        roundTrip(
            `import /* after-import */ { Name1 } /* after-brace */ from "file.agr";\n`,
        );
    });

    it("wildcard import with block comment after star", () => {
        roundTrip(`import * /* after-star */ from "other.agr";\n`);
    });

    it("wildcard import with block comment after import keyword", () => {
        roundTrip(
            `import /* after-import */ * /* after-star */ from "other.agr";\n`,
        );
    });

    it("comments inside empty object value", () => {
        roundTrip(`<A> = x -> { /* only comment */ };\n`);
    });

    it("comments inside empty array value", () => {
        roundTrip(`<A> = x -> [ /* only comment */ ];\n`);
    });

    // Export keyword round-trips
    it("exported rule definition", () => {
        roundTrip(`export <Rule1> = hello;
`);
    });

    it("multiple rules with mixed export", () => {
        roundTrip(`export <Rule1> = hello;
<Rule2> = world;
`);
    });

    it("export with leading comment", () => {
        roundTrip(`// export comment
export <Rule1> = hello;
`);
    });

    it("export with trailing comment", () => {
        roundTrip(`export <Rule1> = hello; // trailing
`);
    });

    it("export with comment after export keyword", () => {
        roundTrip(`export /* after-export */ <Rule1> = hello;
`);
    });

    it("export with spacing annotation", () => {
        roundTrip(`export <Rule1> [spacing=required] = hello;
`);
    });
});
