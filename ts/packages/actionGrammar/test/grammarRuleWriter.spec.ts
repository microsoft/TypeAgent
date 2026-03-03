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
    it("with spacing=auto annotation (normalized away by writer)", () => {
        // "auto" is the default (undefined); the writer omits the annotation
        const result = parseGrammarRules(
            "orig",
            `<test> [spacing=auto] = hello world;`,
            false,
        );
        expect(result.definitions[0].spacingMode).toBeUndefined();
        expect(writeGrammarRules(result)).toBe("<test> = hello world;\n");
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
});
