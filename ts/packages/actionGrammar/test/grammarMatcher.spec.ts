// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { Grammar } from "../src/grammarTypes.js";
import { escapedSpaces, spaces } from "./testUtils.js";

function testMatchGrammar(grammar: Grammar, request: string) {
    return matchGrammar(grammar, request)?.map((m) => m.match);
}
describe("Grammar Matcher", () => {
    describe("Basic Matched Values", () => {
        const values = [
            true,
            false,
            0,
            1,
            "value",
            { prop: true, num: 1, obj: { str: "string" } },
            [true, false, 0, 1],
            [{ arr: [{ nested: true }] }],
        ];
        it.each(values)("matched value - '%j'", (v) => {
            const g = `<Start> = hello world -> ${JSON.stringify(v)};`;
            const grammar = loadGrammarRules("test.grammar", g);
            const match = testMatchGrammar(grammar, "hello world");
            expect(match).toStrictEqual([v]);
        });
    });
    describe("Basic Match", () => {
        const g = `<Start> = hello world -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);

        it("space prefix", () => {
            expect(
                testMatchGrammar(grammar, `${spaces}hello world`),
            ).toStrictEqual([true]);
        });
        it("space infix", () => {
            expect(
                testMatchGrammar(grammar, `hello${spaces}world`),
            ).toStrictEqual([true]);
        });
        it("space suffix", () => {
            expect(
                testMatchGrammar(grammar, `hello world${spaces}`),
            ).toStrictEqual([true]);
        });
        it("ignore case", () => {
            expect(testMatchGrammar(grammar, `HELLO WORLD`)).toStrictEqual([
                true,
            ]);
        });
    });
    describe("Escaped Match", () => {
        it("escaped space prefix", () => {
            const g = `<Start> = ${escapedSpaces}hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, `${spaces}hello world`),
            ).toStrictEqual([true]);
        });
        it("escaped space prefix - alt space", () => {
            const g = `<Start> = ${escapedSpaces}hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, `${spaces}hello\tworld`),
            ).toStrictEqual([true]);
        });
        it("escaped space prefix - extra space", () => {
            const g = `<Start> = ${escapedSpaces}hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, ` ${spaces}hello \nworld`),
            ).toStrictEqual([true]);
        });
        it("escaped space - not match", () => {
            const g = `<Start> = ${escapedSpaces}hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, `${spaces} hello world`),
            ).toStrictEqual([]);
        });
        it("escaped space infix", () => {
            const g = `<Start> = hello${escapedSpaces} world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, `hello${spaces} world`),
            ).toStrictEqual([true]);
        });
        it("escaped space infix - extra space", () => {
            const g = `<Start> = hello${escapedSpaces} world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, `hello${spaces} \r\vworld`),
            ).toStrictEqual([true]);
        });
        it("escaped space infix - literal as separator", () => {
            // The escaped-space segment ends with \u3000 (ideographic space).
            // \u3000 is not a word-boundary-script character (not in
            // wordBoundaryScriptRe and not an ASCII letter), so
            // needsSeparatorInAutoMode('\u3000', 'w') returns false.
            // The flex-space between the segment and "world" therefore allows
            // zero separators in auto mode — no extra separator is required.
            const g = `<Start> = hello${escapedSpaces} world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, `hello${spaces}world`),
            ).toStrictEqual([true]);
        });
        it("escaped space infix - not match", () => {
            const g = `<Start> = hello${escapedSpaces} world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            // An extra space before the escaped-spaces block is a content mismatch:
            // segment 1 literal is "hello \t…\u3000" but the input "hello  \t…"
            // has a double space at that position.
            expect(
                testMatchGrammar(grammar, `hello ${spaces} world`),
            ).toStrictEqual([]);
        });
        it("escaped space infix - no space", () => {
            const g = `<Start> = hello${escapedSpaces}world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, `hello${spaces}world`),
            ).toStrictEqual([true]);
            expect(
                testMatchGrammar(grammar, `hello ${spaces} world`),
            ).toStrictEqual([]);
        });
    });
    describe("Punctuation as Separator", () => {
        // In "auto" and "optional" modes a punctuation character adjacent to a
        // flex-space position — at the end of the preceding literal or at the
        // start of the following literal — satisfies the separator requirement;
        // no additional separator is required in the input.
        // In "required" mode at least one separator character must always be
        // present in the input, regardless of adjacent literal content.
        describe("auto mode", () => {
            it("punctuation at end of preceding literal", () => {
                const g = `<Start> = hello, world -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                // comma satisfies the flex-space; no extra separator needed
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual([
                    true,
                ]);
                // extra separator also accepted
                expect(testMatchGrammar(grammar, "hello, world")).toStrictEqual(
                    [true],
                );
                // literal comma must be present
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual(
                    [],
                );
            });
            it("punctuation at start of following literal", () => {
                const g = `<Start> = hello ,world -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                // comma satisfies the flex-space from the following side
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual([
                    true,
                ]);
                expect(testMatchGrammar(grammar, "hello ,world")).toStrictEqual(
                    [true],
                );
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual(
                    [],
                );
            });
            it("punctuation trailing boundary", () => {
                // Use a wildcard to consume the remaining input so finalizeState
                // does not reject trailing non-separator content. isBoundarySatisfied
                // is what determines whether the boundary after the comma passes.
                const g = `<Start> = hello,$(x) -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                // trailing comma is a sufficient boundary; wildcard captures rest
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual([
                    true,
                ]);
                expect(testMatchGrammar(grammar, "hello, world")).toStrictEqual(
                    [true],
                );
            });
        });
        describe("required mode", () => {
            it("punctuation at end of preceding literal", () => {
                const g = `<Start> [spacing=required] = hello, world -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                // comma alone does not satisfy the boundary; a separator in the
                // input is still required
                expect(testMatchGrammar(grammar, "hello, world")).toStrictEqual(
                    [true],
                );
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual(
                    [],
                );
            });
            it("punctuation at start of following literal", () => {
                const g = `<Start> [spacing=required] = hello ,world -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello ,world")).toStrictEqual(
                    [true],
                );
                // comma is consumed by the required separator, leaving nothing
                // to match the leading comma of the next literal
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual(
                    [],
                );
            });
            it("punctuation trailing boundary", () => {
                const g = `<Start> [spacing=required] = hello,$(x) -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                // separator must come from the input after the comma
                expect(testMatchGrammar(grammar, "hello, world")).toStrictEqual(
                    [true],
                );
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual(
                    [],
                );
            });
        });
        describe("optional mode", () => {
            it("punctuation at end of preceding literal", () => {
                const g = `<Start> [spacing=optional] = hello, world -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual([
                    true,
                ]);
                expect(testMatchGrammar(grammar, "hello, world")).toStrictEqual(
                    [true],
                );
            });
            it("punctuation at start of following literal", () => {
                const g = `<Start> [spacing=optional] = hello ,world -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual([
                    true,
                ]);
                expect(testMatchGrammar(grammar, "hello ,world")).toStrictEqual(
                    [true],
                );
            });
            it("punctuation trailing boundary", () => {
                const g = `<Start> [spacing=optional] = hello,$(x) -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual([
                    true,
                ]);
                expect(testMatchGrammar(grammar, "hello, world")).toStrictEqual(
                    [true],
                );
            });
        });
    });
    describe("Variable Match", () => {
        it("simple variable - explicit string", () => {
            const g = `<Start> = $(x:string) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "value")).toStrictEqual(["value"]);
        });
        it("simple variable - explicit type name", () => {
            const g = `
                import { TrackName } from "types.ts";
                <Start> = $(x:TrackName) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "value")).toStrictEqual(["value"]);
        });
        it("simple variable - implicit string type", () => {
            const g = `<Start> = $(x) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "value")).toStrictEqual(["value"]);
        });
        it("simple variable - simple integer", () => {
            const g = `<Start> = $(x:number) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "1234")).toStrictEqual([1234]);
        });
        it("simple variable - minus integer", () => {
            const g = `<Start> = $(x:number) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "-1234")).toStrictEqual([-1234]);
        });
        it("simple variable - plus integer", () => {
            const g = `<Start> = $(x:number) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "+1234")).toStrictEqual([1234]);
        });
        it("simple variable - octal", () => {
            const g = `<Start> = $(x:number) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "0o123")).toStrictEqual([0o123]);
        });
        it("simple variable - binary", () => {
            const g = `<Start> = $(x:number) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "0b0101")).toStrictEqual([0b101]);
        });
        it("simple variable - hex", () => {
            const g = `<Start> = $(x:number) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "0x123")).toStrictEqual([0x123]);
        });
        it("simple variable - float", () => {
            const g = `<Start> = $(x:number) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "10.123")).toStrictEqual([10.123]);
        });

        it("simple variable - negative float", () => {
            const g = `<Start> = $(x:number) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "-02120.123")).toStrictEqual([
                -2120.123,
            ]);
        });
        it("simple variable - float with exponent", () => {
            const g = `<Start> = $(x:number) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "45.678e-9")).toStrictEqual([
                45.678e-9,
            ]);
        });
        it("simple variable - optional", () => {
            const g = `<Start> = hello $(x:number)? -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "hello")).toStrictEqual([
                undefined,
            ]);
        });
        it("space around variable - string", () => {
            const g = `<Start> = hello $(x) world -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, `hello${spaces}value${spaces}world`),
            ).toStrictEqual(["value"]);
        });
        it("space around variable - number", () => {
            const g = `<Start> = hello $(x:number) world -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, `hello${spaces}123${spaces}world`),
            ).toStrictEqual([123]);
        });

        it("no space around variable - number and string not separated", () => {
            const g = `<Start> = $(x:number) $(y: string)-> { n: x, s: y };`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "1234b")).toStrictEqual([
                { n: 1234, s: "b" },
            ]);
        });

        it("no space around variable - number and term not separated", () => {
            const g = `<Start> = $(x:number)\\-$(y:number)pm -> { a: x, b: y };`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "1-2pm")).toStrictEqual([
                { a: 1, b: 2 },
            ]);
        });
        it("multiple", () => {
            const g = `
                <Start> = $(x:number) -> x;
                <Start> = $(x) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "13.348")).toStrictEqual([
                13.348,
                "13.348",
            ]);
        });
        it("nested rules", () => {
            const g = `
            <Start> = $(x:<Hello>) $(y:<World>) -> { hello: x, world: y };
            <Hello> = hello -> "hello";
            <World> = world -> "world";
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                { hello: "hello", world: "world" },
            ]);
        });
        it("nested rules - default value", () => {
            const g = `
            <Start> = <Hello>;
            <Hello> = hello -> "first";
            <Hello> = hello -> "second";
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "hello")).toStrictEqual([
                "first",
                "second",
            ]);
        });
        it("nested rules - default value with str expr", () => {
            const g = `
            <Start> = A $(h:<Hello>) world -> h;
            <Hello> = hello -> "first";
            <Hello> = hello -> "second";
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "a hello world")).toStrictEqual([
                "first",
                "second",
            ]);
        });

        it("nested rules - single string part captures matched text", () => {
            const g = `
            <Start> = $(x:<Hello>) -> x;
            <Hello> = hello;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "hello")).toStrictEqual(["hello"]);
        });

        it("nested rules - single string part with multiple words", () => {
            const g = `
            <Start> = $(x:<Greeting>) -> x;
            <Greeting> = hello world;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                "hello world",
            ]);
        });

        it("nested rules - single string part in complex expression", () => {
            const g = `
            <Start> = $(a:<First>) and $(b:<Second>) -> { a, b };
            <First> = first;
            <Second> = second;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "first and second")).toStrictEqual(
                [{ a: "first", b: "second" }],
            );
        });

        it("nested rules - multiple parts should not capture default", () => {
            const g = `
            <Start> = $(x:<HelloWorld>) -> x;
            <HelloWorld> = <Hello> <World>;
            <Hello> = hello;
            <World> = world;
            `;
            expect(() => loadGrammarRules("test.grammar", g)).toThrow(
                "Referenced rule '<HelloWorld>' does not produce a value for variable 'x' in definition '<Start>'",
            );
        });

        it("wildcard ", () => {
            const g = `
            <Start> = hello $(x) world -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, "hello this is a test world"),
            ).toStrictEqual(["this is a test"]);
        });
        it("wildcard at end of nested rule", () => {
            const g = `
            <Start> = $(h:<Hello>) world -> h;
            <Hello> = hello $(x) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, "hello   this is a test   world"),
            ).toStrictEqual(["this is a test"]);
        });

        it("wildcard at before the nested rule", () => {
            const g = `
            <Start> = hello $(x) <World> -> x;
            <World> = world;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, "hello   this is a test   world"),
            ).toStrictEqual(["this is a test"]);
        });

        it("wildcard alternates", () => {
            const g = `<Start> = $(x) by $(y) -> [x, y];`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, "song by the sea by Bach"),
            ).toStrictEqual([
                ["song", "the sea by Bach"],
                ["song by the sea", "Bach"],
            ]);
        });
    });
    describe("Repeat GroupExpr", () => {
        it("()* - zero matches", () => {
            const g = `<Start> = hello (world)* -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "hello")).toStrictEqual([true]);
        });
        it("()* - one match", () => {
            const g = `<Start> = hello (world)* -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                true,
            ]);
        });
        it("()* - two matches", () => {
            const g = `<Start> = hello (world)* -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, "hello world world"),
            ).toStrictEqual([true]);
        });
        it("()+ - zero matches not accepted", () => {
            const g = `<Start> = hello (world)+ -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "hello")).toStrictEqual([]);
        });
        it("()+ - one match", () => {
            const g = `<Start> = hello (world)+ -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                true,
            ]);
        });
        it("()+ - two matches", () => {
            const g = `<Start> = hello (world)+ -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, "hello world world"),
            ).toStrictEqual([true]);
        });
        it("()* - alternates in group", () => {
            const g = `<Start> = hello (world | earth)* -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, "hello world earth world"),
            ).toStrictEqual([true]);
        });
        it("()+ - suffix after repeat", () => {
            const g = `<Start> = hello (world)+ end -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, "hello world world end"),
            ).toStrictEqual([true]);
        });
    });
    describe("Not matched", () => {
        it("string expr not separated", () => {
            const g = `
            <Start> = hello world -> true;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([]);
        });
        it("sub-string expr not separated", () => {
            const g = `
            <Start> = <hello> <world> -> true;
            <hello> = hello;
            <world> = world;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([]);
        });
        it("trailing text", () => {
            const g = `
            <Start> = hello world -> true;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "hello world more")).toStrictEqual(
                [],
            );
        });
        it("number variable - minus octal", () => {
            const g = `<Start> = $(x:number) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "-0o123")).toStrictEqual([]);
        });
        it("number variable - plus octal", () => {
            const g = `<Start> = $(x:number) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "+0o123")).toStrictEqual([]);
        });

        it("number variable - minus binary", () => {
            const g = `<Start> = $(x:number) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "-0b101")).toStrictEqual([]);
        });
        it("number variable - plus binary", () => {
            const g = `<Start> = $(x:number) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "+0b0101")).toStrictEqual([]);
        });

        it("number variable - minus octal", () => {
            const g = `<Start> = $(x:number) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "-0x123")).toStrictEqual([]);
        });
        it("number variable - plus octal", () => {
            const g = `<Start> = $(x:number) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "+0x123")).toStrictEqual([]);
        });
    });

    describe("Recursive rules", () => {
        // Regression: when a rule has a non-epsilon back-reference to itself,
        // the compiled RulesPart.rules must point to the final populated array,
        // not the empty sentinel assigned before compilation begins.
        // If the sentinel is captured (bug), the recursive match silently fails.
        it("right-recursive rule reference can match multi-token input", () => {
            // <Start> = foo <Start> -> "hit" | bar -> "bar"
            // "foo bar": foo consumes mandatory input, then <Start> matches "bar"
            const g = `
                <Start> = foo <Start> -> "hit"
                        | bar -> "bar";
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual(["hit"]);
        });

        it("right-recursive variable rule can match multi-token input", () => {
            // <Start> = foo $(x:<Start>) -> x | bar -> "bar"
            // "foo bar": foo consumes mandatory input, then $(x:<Start>) captures "bar"
            const g = `
                <Start> = foo $(x:<Start>) -> x
                        | bar -> "bar";
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual(["bar"]);
        });
    });

    describe("Space Separator Mode", () => {
        describe("default (auto) - Latin requires space", () => {
            const g = `<Start> = hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match without space", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual(
                    [],
                );
            });
        });

        describe("spacing=required annotation", () => {
            const g = `<Start> [spacing=required] = hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match without space", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual(
                    [],
                );
            });
        });

        describe("spacing=optional annotation", () => {
            const g = `<Start> [spacing=optional] = hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    true,
                ]);
            });
            it("matches without space", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("spacing=none annotation", () => {
            const g = `<Start> [spacing=none] = hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches without space (tokens must be adjacent)", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match with space (flex-space must be zero-width)", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual(
                    [],
                );
            });
        });

        describe("spacing=none with escaped space in literal", () => {
            // An escaped space is a literal character, part of the segment text.
            // It must be matched exactly and must not be confused with a
            // flex-space position.
            const g = `<Start> [spacing=none] = hello\\ world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches when the literal space is present", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match without the literal space", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual(
                    [],
                );
            });
            it("does not match with extra space", () => {
                // "hello  world" has two spaces; only one is in the literal.
                expect(testMatchGrammar(grammar, "hello  world")).toStrictEqual(
                    [],
                );
            });
        });

        describe("spacing=none with escaped space at boundary", () => {
            // Literal trailing space must not cause the boundary check to reject
            // the match when the next character in the input is non-separator.
            const g = `<Start> [spacing=none] = hello\\  -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches input with trailing space", () => {
                expect(testMatchGrammar(grammar, "hello ")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("spacing=none in per-rule mode switching", () => {
            const g = `
                <NoneRule> [spacing=none] = hello world -> "none";
                <OptionalRule> [spacing=optional] = hello world -> "optional";
                <Start> = $(x:<NoneRule>) -> x | $(x:<OptionalRule>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("both match when tokens are adjacent", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    "none",
                    "optional",
                ]);
            });
            it("only optional matches with space", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    "optional",
                ]);
            });
        });

        // ---- spacing=none between different part types ----

        describe("spacing=none: string → number variable", () => {
            const g = `<Start> [spacing=none] = hello $(n:number) -> n;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches when number is adjacent to string", () => {
                expect(testMatchGrammar(grammar, "hello42")).toStrictEqual([
                    42,
                ]);
            });
            it("does not match when space separates string and number", () => {
                expect(testMatchGrammar(grammar, "hello 42")).toStrictEqual([]);
            });
        });

        describe("spacing=none: number variable → string", () => {
            const g = `<Start> [spacing=none] = $(n:number) world -> n;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches when string is adjacent to number", () => {
                expect(testMatchGrammar(grammar, "42world")).toStrictEqual([
                    42,
                ]);
            });
            it("does not match when space separates number and string", () => {
                expect(testMatchGrammar(grammar, "42 world")).toStrictEqual([]);
            });
        });

        describe("spacing=none: string → wildcard → string", () => {
            const g = `<Start> [spacing=none] = hello $(x) world -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches when all parts are adjacent", () => {
                expect(
                    testMatchGrammar(grammar, "hellofooworld"),
                ).toStrictEqual(["foo"]);
            });
            it("captures separators in wildcard value", () => {
                expect(
                    testMatchGrammar(grammar, "hello foo world"),
                ).toStrictEqual([" foo "]);
            });
        });

        describe("spacing=none: string → rule reference", () => {
            const g = `
                <Other> [spacing=none] = world -> "world";
                <Start> [spacing=none] = hello $(x:<Other>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches when nested rule is adjacent", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    "world",
                ]);
            });
            it("does not match when space separates string and rule", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual(
                    [],
                );
            });
        });

        describe("spacing=none: group expressions", () => {
            const g = `<Start> [spacing=none] = (hello | hi) world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches when group and following token are adjacent", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    true,
                ]);
                expect(testMatchGrammar(grammar, "hiworld")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match when space follows group", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual(
                    [],
                );
                expect(testMatchGrammar(grammar, "hi world")).toStrictEqual([]);
            });
        });

        describe("spacing=none: escaped space mixed with flex-space", () => {
            // Grammar: "hello\ " followed by flex-space followed by "world"
            // The escaped space is a literal; the whitespace between the two
            // quoted-like segments is a flex-space that must be zero-width.
            const g = `<Start> [spacing=none] = hello\\  world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches when literal space is present and no flex-space", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match with extra space (flex-space consumed)", () => {
                expect(testMatchGrammar(grammar, "hello  world")).toStrictEqual(
                    [],
                );
            });
            it("does not match without literal space", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual(
                    [],
                );
            });
        });

        describe("spacing=none: string → number → string", () => {
            const g = `<Start> [spacing=none] = item $(n:number) done -> n;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches when all parts are adjacent", () => {
                expect(testMatchGrammar(grammar, "item7done")).toStrictEqual([
                    7,
                ]);
            });
            it("does not match with any spaces", () => {
                expect(testMatchGrammar(grammar, "item 7 done")).toStrictEqual(
                    [],
                );
                expect(testMatchGrammar(grammar, "item7 done")).toStrictEqual(
                    [],
                );
                expect(testMatchGrammar(grammar, "item 7done")).toStrictEqual(
                    [],
                );
            });
        });

        describe("spacing=none rejects punctuation separators", () => {
            const g = `<Start> [spacing=none] = hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("does not match with comma separator", () => {
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual(
                    [],
                );
            });
            it("does not match with period separator", () => {
                expect(testMatchGrammar(grammar, "hello.world")).toStrictEqual(
                    [],
                );
            });
        });

        describe("repeat group ()+ with none mode", () => {
            const g = `<Start> [spacing=none] = hello (world)+ -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches one repetition without space", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    true,
                ]);
            });
            it("matches two repetitions without space", () => {
                expect(
                    testMatchGrammar(grammar, "helloworldworld"),
                ).toStrictEqual([true]);
            });
            it("does not match with space before group", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual(
                    [],
                );
            });
            it("does not match with space between repetitions", () => {
                expect(
                    testMatchGrammar(grammar, "helloworld world"),
                ).toStrictEqual([]);
            });
        });

        describe("repeat group ()* with none mode", () => {
            const g = `<Start> [spacing=none] = hello (world)* -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches zero repetitions", () => {
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([
                    true,
                ]);
            });
            it("matches one repetition without space", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match with space before group", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual(
                    [],
                );
            });
        });

        describe("spacing=none: optional part", () => {
            const g = `<Start> [spacing=none] = hello $(x)? world -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches when optional part is absent", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    undefined,
                ]);
            });
            it("matches when optional part is present and adjacent", () => {
                expect(
                    testMatchGrammar(grammar, "hellofooworld"),
                ).toStrictEqual(["foo"]);
            });
            it("captures separators in optional wildcard value", () => {
                expect(
                    testMatchGrammar(grammar, "hello foo world"),
                ).toStrictEqual([" foo "]);
            });
        });

        describe("spacing=none: optional group expression", () => {
            const g = `<Start> [spacing=none] = (please)? help -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches when optional group is present and adjacent", () => {
                expect(testMatchGrammar(grammar, "pleasehelp")).toStrictEqual([
                    true,
                ]);
            });
            it("matches when optional group is absent", () => {
                expect(testMatchGrammar(grammar, "help")).toStrictEqual([true]);
            });
            it("does not match when space separates group and following token", () => {
                expect(testMatchGrammar(grammar, "please help")).toStrictEqual(
                    [],
                );
            });
        });

        describe("separator AFTER nested rule with none parent mode", () => {
            const g = `
                <Inner> [spacing=none] = hello world -> true;
                <Start> [spacing=none] = $(x:<Inner>) end -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches when all parts are adjacent", () => {
                expect(
                    testMatchGrammar(grammar, "helloworldend"),
                ).toStrictEqual([true]);
            });
            it("does not match with space after nested rule", () => {
                expect(
                    testMatchGrammar(grammar, "helloworld end"),
                ).toStrictEqual([]);
            });
        });

        describe("merged rules with none mode", () => {
            const g = `
                <Start> [spacing=none] = hello world -> "none";
                <Start> [spacing=required] = hello world -> "required";
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("only none matches when adjacent", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    "none",
                ]);
            });
            it("only required matches with space", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    "required",
                ]);
            });
        });

        describe("spacing=none: trailing wildcard (end of rule)", () => {
            const g = `<Start> [spacing=none] = hello $(x) -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("captures trailing text without trimming", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    "world",
                ]);
            });
            it("captures trailing text with spaces as part of value", () => {
                // In "none" mode wildcards do not trim leading/trailing
                // separators because there are no flex-space positions to trim
                // at.  The space before "world" is part of the wildcard value.
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    " world",
                ]);
            });
            it("does not match when wildcard would be empty", () => {
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([]);
            });
        });

        describe("spacing=none: empty wildcard rejection", () => {
            const g = `<Start> [spacing=none] = hello $(x) world -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("rejects when wildcard captures empty string", () => {
                // "helloworld" means the wildcard between hello and world is empty
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual(
                    [],
                );
            });
        });

        describe("empty wildcard rejection - spacing=auto (default)", () => {
            // wildcardTrimRegExp uses .+? so all-whitespace or empty content is rejected
            const g = `<Start> = hello $(x) world -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("rejects when wildcard is pure whitespace (trims to empty)", () => {
                expect(
                    testMatchGrammar(grammar, "hello   world"),
                ).toStrictEqual([]);
            });
            it("matches when wildcard has non-separator content", () => {
                expect(
                    testMatchGrammar(grammar, "hello foo world"),
                ).toStrictEqual(["foo"]);
            });
        });

        describe("empty wildcard rejection - spacing=required", () => {
            const g = `<Start> [spacing=required] = hello $(x) world -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("rejects when wildcard is pure whitespace", () => {
                expect(
                    testMatchGrammar(grammar, "hello   world"),
                ).toStrictEqual([]);
            });
            it("matches when wildcard has non-separator content", () => {
                expect(
                    testMatchGrammar(grammar, "hello foo world"),
                ).toStrictEqual(["foo"]);
            });
        });

        describe("empty wildcard rejection - spacing=optional", () => {
            const g = `<Start> [spacing=optional] = hello $(x) world -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("rejects when wildcard is pure whitespace", () => {
                expect(
                    testMatchGrammar(grammar, "hello   world"),
                ).toStrictEqual([]);
            });
            it("matches when wildcard has non-separator content", () => {
                expect(
                    testMatchGrammar(grammar, "hello foo world"),
                ).toStrictEqual(["foo"]);
            });
        });

        describe("spacing=none: wildcard before number variable", () => {
            const g = `<Start> [spacing=none] = $(x) $(n:number) -> n;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches wildcard followed by number", () => {
                expect(testMatchGrammar(grammar, "abc42")).toStrictEqual([42]);
            });
            it("captures wildcard value correctly", () => {
                const gVal = `<Start> [spacing=none] = $(x) $(n:number) -> x;`;
                const grammar2 = loadGrammarRules("test.grammar", gVal);
                expect(testMatchGrammar(grammar2, "abc42")).toStrictEqual([
                    "abc",
                ]);
            });
        });

        describe("spacing=none: negative and special number formats", () => {
            const g = `<Start> [spacing=none] = item $(n:number) done -> n;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches negative integer", () => {
                expect(testMatchGrammar(grammar, "item-42done")).toStrictEqual([
                    -42,
                ]);
            });
            it("matches hex number", () => {
                // Use suffix starting with non-hex char to avoid greedy capture
                // TODO: Review the case item0xFFdone and see if we should make that work.
                const gHex = `<Start> [spacing=none] = item $(n:number) stop -> n;`;
                const grammarHex = loadGrammarRules("test.grammar", gHex);
                expect(
                    testMatchGrammar(grammarHex, "item0xFFstop"),
                ).toStrictEqual([0xff]);
            });
            it("matches octal number", () => {
                expect(testMatchGrammar(grammar, "item0o77done")).toStrictEqual(
                    [0o77],
                );
            });
            it("matches binary number", () => {
                expect(
                    testMatchGrammar(grammar, "item0b101done"),
                ).toStrictEqual([0b101]);
            });
            it("matches float number", () => {
                expect(testMatchGrammar(grammar, "item3.14done")).toStrictEqual(
                    [3.14],
                );
            });
        });

        describe("spacing=none: rule-level alternatives", () => {
            const g = `<Start> [spacing=none] = hello world -> 1 | foo bar -> 2;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches first alternative when adjacent", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    1,
                ]);
            });
            it("matches second alternative when adjacent", () => {
                expect(testMatchGrammar(grammar, "foobar")).toStrictEqual([2]);
            });
            it("does not match first alternative with space", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual(
                    [],
                );
            });
            it("does not match second alternative with space", () => {
                expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([]);
            });
        });

        describe("spacing=none: case insensitivity", () => {
            const g = `<Start> [spacing=none] = hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches mixed case without space", () => {
                expect(testMatchGrammar(grammar, "HelloWorld")).toStrictEqual([
                    true,
                ]);
            });
            it("matches all caps without space", () => {
                expect(testMatchGrammar(grammar, "HELLOWORLD")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match mixed case with space", () => {
                expect(testMatchGrammar(grammar, "Hello World")).toStrictEqual(
                    [],
                );
            });
        });

        describe("spacing=none: leading/trailing whitespace in input", () => {
            const g = `<Start> [spacing=none] = hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("does not match with leading whitespace", () => {
                // In none mode, no leading separator is consumed
                expect(testMatchGrammar(grammar, "  helloworld")).toStrictEqual(
                    [],
                );
            });
            it("matches with trailing whitespace", () => {
                expect(testMatchGrammar(grammar, "helloworld  ")).toStrictEqual(
                    [true],
                );
            });
            it("does not match with both leading and trailing whitespace", () => {
                expect(
                    testMatchGrammar(grammar, "  helloworld  "),
                ).toStrictEqual([]);
            });
        });

        describe("spacing=none vs other modes: leading whitespace", () => {
            // Counter-test: other modes still consume leading whitespace
            // even though none mode rejects it.
            it("auto mode accepts leading whitespace", () => {
                const g = `<Start> = hello world -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(
                    testMatchGrammar(grammar, "  hello world"),
                ).toStrictEqual([true]);
            });
            it("required mode accepts leading whitespace", () => {
                const g = `<Start> [spacing=required] = hello world -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(
                    testMatchGrammar(grammar, "  hello world"),
                ).toStrictEqual([true]);
            });
            it("optional mode accepts leading whitespace", () => {
                const g = `<Start> [spacing=optional] = hello world -> true;`;
                const grammar = loadGrammarRules("test.grammar", g);
                expect(testMatchGrammar(grammar, "  helloworld")).toStrictEqual(
                    [true],
                );
            });
        });

        describe("spacing=none: CJK characters", () => {
            const g = `<Start> [spacing=none] = 你好 世界 -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches when CJK tokens are adjacent", () => {
                expect(testMatchGrammar(grammar, "你好世界")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match when CJK tokens have space", () => {
                expect(testMatchGrammar(grammar, "你好 世界")).toStrictEqual(
                    [],
                );
            });
        });

        describe("spacing=auto annotation - CJK (Han)", () => {
            // In the grammar, whitespace creates a flex-space boundary.
            // With auto mode, Han characters don't need spaces between them.
            const g = `<Start> [spacing=auto] = 你好 世界 -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches without space", () => {
                expect(testMatchGrammar(grammar, "你好世界")).toStrictEqual([
                    true,
                ]);
            });
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "你好 世界")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("no annotation is identical to [spacing=auto]", () => {
            // Omitting the annotation must produce the same behavior as
            // explicitly writing [spacing=auto] — both store spacingMode as
            // undefined and both enforce word-boundary rules for Latin scripts
            // while allowing adjacent CJK characters.
            it("Latin words without space are rejected in both", () => {
                const gNoAnnotation = loadGrammarRules(
                    "test.grammar",
                    `<Start> = hello world -> true;`,
                );
                const gAutoExplicit = loadGrammarRules(
                    "test.grammar",
                    `<Start> [spacing=auto] = hello world -> true;`,
                );
                expect(
                    testMatchGrammar(gNoAnnotation, "helloworld"),
                ).toStrictEqual([]);
                expect(
                    testMatchGrammar(gAutoExplicit, "helloworld"),
                ).toStrictEqual([]);
            });
            it("CJK characters without space match in both", () => {
                const gNoAnnotation = loadGrammarRules(
                    "test.grammar",
                    `<Start> = 你好 世界 -> true;`,
                );
                const gAutoExplicit = loadGrammarRules(
                    "test.grammar",
                    `<Start> [spacing=auto] = 你好 世界 -> true;`,
                );
                expect(
                    testMatchGrammar(gNoAnnotation, "你好世界"),
                ).toStrictEqual([true]);
                expect(
                    testMatchGrammar(gAutoExplicit, "你好世界"),
                ).toStrictEqual([true]);
            });
        });

        describe("spacing=auto annotation - mixed Latin+CJK boundary", () => {
            // At the Latin→CJK boundary no space is needed (CJK side is no-space)
            const g = `<Start> [spacing=auto] = hello 世界 -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches without space at Latin-CJK boundary", () => {
                expect(testMatchGrammar(grammar, "hello世界")).toStrictEqual([
                    true,
                ]);
            });
            it("matches with space at Latin-CJK boundary", () => {
                expect(testMatchGrammar(grammar, "hello 世界")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("per-rule mode switching", () => {
            // <Start> references two sub-rules declared with different modes.
            const g = `
                <RequiredRule> [spacing=required] = hello world -> "required";
                <OptionalRule> [spacing=optional] = hello world -> "optional";
                <Start> = $(x:<RequiredRule>) -> x | $(x:<OptionalRule>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("both sub-rules match when space is present", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    "required",
                    "optional",
                ]);
            });
            it("only the optional sub-rule matches without space", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    "optional",
                ]);
            });
        });

        describe("nested rule uses its own mode", () => {
            // EnglishRule uses required; NoSpaceRule uses optional.
            // <Start> references both — each sub-rule uses its own declared mode.
            const g = `
                <EnglishRule> [spacing=required] = hello world -> "english";
                <NoSpaceRule> [spacing=optional] = hi there -> "nospace";
                <Start> = $(x:<EnglishRule>) $(y:<NoSpaceRule>) -> { x, y };
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("each nested rule uses its own declared mode", () => {
                // EnglishRule requires space between "hello" and "world";
                // NoSpaceRule allows "hithere" without space.
                expect(
                    testMatchGrammar(grammar, "hello world hithere"),
                ).toStrictEqual([{ x: "english", y: "nospace" }]);
            });
        });

        describe("merged rules - same rule name, different modes", () => {
            // Two definitions of <Start> with different spacing modes.
            // The compiler merges them into one rule with two alternatives,
            // each carrying its own declared mode.
            const g = `
                <Start> [spacing=required] = hello world -> "required";
                <Start> [spacing=optional] = hello world -> "optional";
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("both alternatives match when space is present", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    "required",
                    "optional",
                ]);
            });
            it("only the optional alternative matches without space", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    "optional",
                ]);
            });
        });

        describe("inline group inherits enclosing rule mode", () => {
            const g = `<Start> [spacing=optional] = hello (world | earth) -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    true,
                ]);
            });
            it("matches without space (inherits optional)", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    true,
                ]);
            });
            it("matches second alternative without space", () => {
                expect(testMatchGrammar(grammar, "helloearth")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("same-name rule with different modes merged", () => {
            // <Greeting> is defined twice with different modes; each alternative
            // must respect its own declared spacingMode.
            const g = `
                <Greeting> [spacing=optional] = hello world -> "optional";
                <Greeting> [spacing=required] = good morning -> "required";
                <Start> = <Greeting>;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("optional alternative matches without space", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    "optional",
                ]);
            });
            it("required alternative matches with space", () => {
                expect(testMatchGrammar(grammar, "good morning")).toStrictEqual(
                    ["required"],
                );
            });
            it("required alternative does not match without space", () => {
                expect(testMatchGrammar(grammar, "goodmorning")).toStrictEqual(
                    [],
                );
            });
        });

        describe("rule without annotation uses auto/default mode", () => {
            // <Before> has no annotation — must behave identically to
            // [spacing=auto]: Latin words require a separator, CJK do not.
            const g = `
                <Before> = hello world -> "before";
                <After> [spacing=optional] = hello world -> "after";
                <Start> = $(x:<Before>) -> x | $(x:<After>) -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("<Before> requires space between Latin words (auto default)", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    "before",
                    "after",
                ]);
            });
            it("<Before> does not match without space (auto default)", () => {
                // Only the optional <After> alternative should match.
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    "after",
                ]);
            });
        });

        describe("parse error - unknown annotation key", () => {
            it("throws on unknown annotation key", () => {
                expect(() =>
                    loadGrammarRules(
                        "test.grammar",
                        `<Start> [unknown=auto] = hello -> true;`,
                    ),
                ).toThrow("Unknown rule annotation");
            });
        });

        describe("parse error - invalid spacing value", () => {
            it("throws on invalid value", () => {
                expect(() =>
                    loadGrammarRules(
                        "test.grammar",
                        `<Start> [spacing=never] = hello -> true;`,
                    ),
                ).toThrow("Invalid value");
            });
        });

        describe("spacing=auto annotation - Hangul (Korean)", () => {
            // Hangul is in wordBoundaryScriptRe so adjacent Hangul syllables
            // require a separator, just like Latin.
            const g = `<Start> [spacing=auto] = 안녕 세계 -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("does not match without space (Hangul requires separator)", () => {
                expect(testMatchGrammar(grammar, "안녕세계")).toStrictEqual([]);
            });
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "안녕 세계")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("spacing=auto annotation - CJK→Latin boundary", () => {
            // Reverse of the Latin→CJK test: CJK on the left, Latin on the right.
            // CJK is not in wordBoundaryScriptRe so no space is needed at this boundary.
            const g = `<Start> [spacing=auto] = 世界 hello -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches without space at CJK-Latin boundary", () => {
                expect(testMatchGrammar(grammar, "世界hello")).toStrictEqual([
                    true,
                ]);
            });
            it("matches with space at CJK-Latin boundary", () => {
                expect(testMatchGrammar(grammar, "世界 hello")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("spacing=required annotation - punctuation-only separator in input", () => {
            // required mode uses [\s\p{P}]+ which accepts punctuation characters.
            const g = `<Start> [spacing=required] = hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("accepts a comma as the separator", () => {
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual([
                    true,
                ]);
            });
            it("accepts a period as the separator", () => {
                expect(testMatchGrammar(grammar, "hello.world")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("repeat group ()* inherits optional mode", () => {
            const g = `<Start> [spacing=optional] = hello (world)* -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches zero repetitions", () => {
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([
                    true,
                ]);
            });
            it("matches one repetition without space (optional mode)", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    true,
                ]);
            });
            it("matches two repetitions without space (optional mode)", () => {
                expect(
                    testMatchGrammar(grammar, "helloworldworld"),
                ).toStrictEqual([true]);
            });
        });

        describe("repeat group ()+ with required mode", () => {
            const g = `<Start> [spacing=required] = hello (world)+ -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches one repetition with space", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match without space before group", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual(
                    [],
                );
            });
            it("matches two repetitions with spaces", () => {
                expect(
                    testMatchGrammar(grammar, "hello world world"),
                ).toStrictEqual([true]);
            });
            it("does not match when repetitions are not space-separated", () => {
                // The first 'world' ends with 'w' at index 11 in input; required
                // mode rejects a match unless a separator follows the token.
                expect(
                    testMatchGrammar(grammar, "hello worldworld"),
                ).toStrictEqual([]);
            });
        });

        describe("repeat group ()+ with optional mode", () => {
            const g = `<Start> [spacing=optional] = hello (world)+ -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches one repetition without space (optional mode)", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    true,
                ]);
            });
            it("matches two repetitions without space (optional mode)", () => {
                expect(
                    testMatchGrammar(grammar, "helloworldworld"),
                ).toStrictEqual([true]);
            });
            it("matches two repetitions with spaces (optional mode)", () => {
                expect(
                    testMatchGrammar(grammar, "hello world world"),
                ).toStrictEqual([true]);
            });
        });

        describe("[spacing=auto] - digit-Latin boundary does not require space", () => {
            // One side being a digit and the other Latin: no space needed.
            const g = `<Start> = 123 hello -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches without space at digit-Latin boundary", () => {
                expect(testMatchGrammar(grammar, "123hello")).toStrictEqual([
                    true,
                ]);
            });
            it("matches with space at digit-Latin boundary", () => {
                expect(testMatchGrammar(grammar, "123 hello")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("[spacing=auto] - digit-digit boundary requires space", () => {
            // Both sides are digits: a separator is required because "123456"
            // is a different token from "123 456".
            const g = `<Start> = 123 456 -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("does not match without space at digit-digit boundary", () => {
                expect(testMatchGrammar(grammar, "123456")).toStrictEqual([]);
            });
            it("matches with space at digit-digit boundary", () => {
                expect(testMatchGrammar(grammar, "123 456")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("number variable respects spacingMode", () => {
            describe("required mode - trailing separator after number", () => {
                const g = `<Start> [spacing=required] = set $(n:number) items -> n;`;
                const grammar = loadGrammarRules("test.grammar", g);
                it("rejects number immediately followed by word (no separator)", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50items"),
                    ).toStrictEqual([]);
                });
                it("accepts number followed by space then word", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50 items"),
                    ).toStrictEqual([50]);
                });
            });

            describe("optional mode - trailing separator after number", () => {
                const g = `<Start> [spacing=optional] = set $(n:number) items -> n;`;
                const grammar = loadGrammarRules("test.grammar", g);
                it("accepts number immediately followed by word (no separator needed)", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50items"),
                    ).toStrictEqual([50]);
                });
                it("accepts number followed by space then word", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50 items"),
                    ).toStrictEqual([50]);
                });
            });

            describe("auto mode - digit-Latin boundary does not require space", () => {
                // Digit followed by Latin: not both in wordBoundaryScriptRe, so no separator needed.
                const g = `<Start> = set $(n:number) items -> n;`;
                const grammar = loadGrammarRules("test.grammar", g);
                it("accepts number immediately followed by Latin word (auto mode)", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50items"),
                    ).toStrictEqual([50]);
                });
            });

            describe("required mode - number at start of rule (no preceding part)", () => {
                // Verifies the trailing separator check fires even when there is no
                // preceding string part whose own isBoundarySatisfied check would have
                // enforced a separator earlier.
                const g = `<Start> [spacing=required] = $(n:number) items -> n;`;
                const grammar = loadGrammarRules("test.grammar", g);
                it("rejects number immediately followed by word (no separator)", () => {
                    expect(testMatchGrammar(grammar, "50items")).toStrictEqual(
                        [],
                    );
                });
                it("accepts number followed by space then word", () => {
                    expect(testMatchGrammar(grammar, "50 items")).toStrictEqual(
                        [50],
                    );
                });
            });

            describe("auto mode - digit-digit boundary requires space after number variable", () => {
                // Both the end of the matched number and the start of the next
                // literal are digits → isBoundarySatisfied returns false in auto mode.
                const g = `<Start> = $(n:number) 456 -> n;`;
                const grammar = loadGrammarRules("test.grammar", g);
                it("rejects number immediately followed by digit literal (no separator)", () => {
                    expect(testMatchGrammar(grammar, "123456")).toStrictEqual(
                        [],
                    );
                });
                it("accepts number followed by space then digit literal", () => {
                    expect(testMatchGrammar(grammar, "123 456")).toStrictEqual([
                        123,
                    ]);
                });
            });

            describe("required mode - number with wildcard trailing separator", () => {
                const g = `<Start> [spacing=required] = $(x) $(n:number) end -> n;`;
                const grammar = loadGrammarRules("test.grammar", g);
                it("rejects number immediately followed by word (no separator)", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50end"),
                    ).toStrictEqual([]);
                });
                it("accepts number followed by space then word", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50 end"),
                    ).toStrictEqual([50]);
                });
            });

            describe("optional mode - number with wildcard trailing separator", () => {
                // In optional mode the wildcard path should accept no separator.
                const g = `<Start> [spacing=optional] = $(x) $(n:number) end -> n;`;
                const grammar = loadGrammarRules("test.grammar", g);
                it("accepts number immediately followed by word (no separator needed)", () => {
                    expect(testMatchGrammar(grammar, "set50end")).toStrictEqual(
                        [50],
                    );
                });
                it("accepts number followed by space then word", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50 end"),
                    ).toStrictEqual([50]);
                });
            });
        });

        describe("separator AFTER a rule reference follows parent mode", () => {
            // The nested rule uses optional mode, so its own isBoundarySatisfied check
            // always passes. The separator AFTER the rule reference must be
            // validated using the parent (outer) rule's spacingMode.
            describe("parent required, nested optional", () => {
                const g = `
                    <Inner> [spacing=optional] = hello world -> true;
                    <Start> [spacing=required] = $(x:<Inner>) end -> x;
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                it("matches when space is present after rule reference", () => {
                    expect(
                        testMatchGrammar(grammar, "helloworld end"),
                    ).toStrictEqual([true]);
                });
                it("does not match without space after rule reference (parent required)", () => {
                    expect(
                        testMatchGrammar(grammar, "helloworldend"),
                    ).toStrictEqual([]);
                });
            });

            describe("parent optional, nested required", () => {
                // The nested rule's own required mode enforces a separator
                // after its last token, so "hello worldend" is rejected by
                // the inner rule itself regardless of the outer mode.
                const g = `
                    <Inner> [spacing=required] = hello world -> true;
                    <Start> [spacing=optional] = $(x:<Inner>) end -> x;
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                it("matches when space is present after rule reference", () => {
                    expect(
                        testMatchGrammar(grammar, "hello world end"),
                    ).toStrictEqual([true]);
                });
                it("does not match without space (inner required mode enforces the boundary)", () => {
                    expect(
                        testMatchGrammar(grammar, "hello worldend"),
                    ).toStrictEqual([]);
                });
            });
            describe("deeply nested: grandparent optional, parent required pass-through, grandchild optional", () => {
                // Bug: A(optional) -> B(required, single-part pass-through) -> C(optional)
                // After C finishes, finalizeNestedRule restores B's "required" mode and
                // the separator check fires against it — rejecting "barbaz" even though
                // A (the nearest ancestor with a following part) uses "optional" mode.
                // The correct behaviour is to walk up to the first ancestor that still
                // has remaining parts and use *that* ancestor's spacingMode.
                const g = `
                    <Inner> [spacing=optional] = bar -> true;
                    <Middle> [spacing=required] = $(x:<Inner>) -> x;
                    <Start> [spacing=optional] = $(x:<Middle>) baz -> x;
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                it("matches with space (works today)", () => {
                    expect(testMatchGrammar(grammar, "bar baz")).toStrictEqual([
                        true,
                    ]);
                });
                it("matches without space (grandparent optional mode governs the separator after the pass-through)", () => {
                    expect(testMatchGrammar(grammar, "barbaz")).toStrictEqual([
                        true,
                    ]);
                });
            });
            describe("deeply nested: grandparent required, parent optional pass-through, grandchild optional", () => {
                // The separator check is deferred past the exhausted optional parent
                // and fires at the grandparent level with "required" mode.
                const g = `
                    <Inner> [spacing=optional] = bar -> true;
                    <Middle> [spacing=optional] = $(x:<Inner>) -> x;
                    <Start> [spacing=required] = $(x:<Middle>) baz -> x;
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                it("matches with space", () => {
                    expect(testMatchGrammar(grammar, "bar baz")).toStrictEqual([
                        true,
                    ]);
                });
                it("does not match without space (grandparent required governs)", () => {
                    expect(testMatchGrammar(grammar, "barbaz")).toStrictEqual(
                        [],
                    );
                });
            });
            describe("deeply nested: grandparent auto (default), parent required pass-through, grandchild optional", () => {
                // auto mode: both "bar" and "baz" are Latin → space is required.
                const g = `
                    <Inner> [spacing=optional] = bar -> true;
                    <Middle> [spacing=required] = $(x:<Inner>) -> x;
                    <Start> = $(x:<Middle>) baz -> x;
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                it("matches with space", () => {
                    expect(testMatchGrammar(grammar, "bar baz")).toStrictEqual([
                        true,
                    ]);
                });
                it("does not match without space (auto mode: Latin-Latin boundary requires space)", () => {
                    expect(testMatchGrammar(grammar, "barbaz")).toStrictEqual(
                        [],
                    );
                });
            });
            describe("deeply nested: grandchild required enforces its own internal separator", () => {
                // grandchild=required: the string-match isBoundarySatisfied check inside
                // grandchild rejects "bar" immediately followed by "baz" before
                // the nested-rule separator logic even runs.
                const g = `
                    <Inner> [spacing=required] = bar -> true;
                    <Middle> [spacing=optional] = $(x:<Inner>) -> x;
                    <Start> [spacing=optional] = $(x:<Middle>) baz -> x;
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                it("matches with space", () => {
                    expect(testMatchGrammar(grammar, "bar baz")).toStrictEqual([
                        true,
                    ]);
                });
                it("does not match without space (grandchild required catches it internally)", () => {
                    expect(testMatchGrammar(grammar, "barbaz")).toStrictEqual(
                        [],
                    );
                });
            });
            describe("4 levels deep: great-grandparent optional, two required pass-through levels, leaf optional", () => {
                // The fix must skip multiple exhausted ancestors and fire only at
                // the great-grandparent which has a following part ("baz").
                const g = `
                    <Leaf> [spacing=optional] = bar -> true;
                    <LevelA> [spacing=required] = $(x:<Leaf>) -> x;
                    <LevelB> [spacing=required] = $(x:<LevelA>) -> x;
                    <Start> [spacing=optional] = $(x:<LevelB>) baz -> x;
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                it("matches with space", () => {
                    expect(testMatchGrammar(grammar, "bar baz")).toStrictEqual([
                        true,
                    ]);
                });
                it("matches without space (great-grandparent optional governs after two exhausted pass-through levels)", () => {
                    expect(testMatchGrammar(grammar, "barbaz")).toStrictEqual([
                        true,
                    ]);
                });
            });
            describe("4 levels deep: great-grandparent required, two optional pass-through levels, leaf optional", () => {
                // The boundary check defers past two exhausted optional ancestors
                // and fires at the great-grandparent with "required" mode.
                const g = `
                    <Leaf> [spacing=optional] = bar -> true;
                    <LevelA> [spacing=optional] = $(x:<Leaf>) -> x;
                    <LevelB> [spacing=optional] = $(x:<LevelA>) -> x;
                    <Start> [spacing=required] = $(x:<LevelB>) baz -> x;
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                it("matches with space", () => {
                    expect(testMatchGrammar(grammar, "bar baz")).toStrictEqual([
                        true,
                    ]);
                });
                it("does not match without space (great-grandparent required governs)", () => {
                    expect(testMatchGrammar(grammar, "barbaz")).toStrictEqual(
                        [],
                    );
                });
            });
        });

        describe("separator BEFORE a nested rule reference uses ancestor mode", () => {
            // Symmetric to the "after" tests: when a pass-through chain (A->X) ends
            // and the next sibling part in the ancestor is another nested rule (B),
            // the inter-rule separator is governed by the common ancestor's
            // spacingMode — not by any intermediate exhausted rule's mode.
            describe("grandparent optional, pass-through chain before sibling rule", () => {
                // Start(optional): [A(required)->X(optional) "foo"] then [B(optional) "bar"]
                // The separator between "foo" and "bar" uses Start's "optional" mode.
                const g = `
                    <X> [spacing=optional] = foo -> "x";
                    <A> [spacing=required] = $(x:<X>) -> x;
                    <B> [spacing=optional] = bar -> "b";
                    <Start> [spacing=optional] = $(a:<A>) $(b:<B>) -> [a, b];
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                it("matches with space", () => {
                    expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([
                        ["x", "b"],
                    ]);
                });
                it("matches without space (Start optional governs the inter-rule boundary)", () => {
                    expect(testMatchGrammar(grammar, "foobar")).toStrictEqual([
                        ["x", "b"],
                    ]);
                });
            });
            describe("grandparent required, pass-through chain before sibling rule", () => {
                // Start(required): [A(optional)->X(optional) "foo"] then [B(optional) "bar"]
                // The separator uses Start's "required" mode regardless of A and X being optional.
                const g = `
                    <X> [spacing=optional] = foo -> "x";
                    <A> [spacing=optional] = $(x:<X>) -> x;
                    <B> [spacing=optional] = bar -> "b";
                    <Start> [spacing=required] = $(a:<A>) $(b:<B>) -> [a, b];
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                it("matches with space", () => {
                    expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([
                        ["x", "b"],
                    ]);
                });
                it("does not match without space (Start required governs)", () => {
                    expect(testMatchGrammar(grammar, "foobar")).toStrictEqual(
                        [],
                    );
                });
            });
            describe("4 levels deep, great-grandparent optional, pass-through chain before sibling rule", () => {
                // Start(optional): [A(required)->B(required)->X(optional) "foo"] then [C(optional) "bar"]
                // Two exhausted required pass-through levels; Start's optional mode governs.
                const g = `
                    <X> [spacing=optional] = foo -> "x";
                    <B> [spacing=required] = $(x:<X>) -> x;
                    <A> [spacing=required] = $(b:<B>) -> b;
                    <C> [spacing=optional] = bar -> "c";
                    <Start> [spacing=optional] = $(a:<A>) $(c:<C>) -> [a, c];
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                it("matches with space", () => {
                    expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([
                        ["x", "c"],
                    ]);
                });
                it("matches without space (Start optional governs after two exhausted pass-through levels)", () => {
                    expect(testMatchGrammar(grammar, "foobar")).toStrictEqual([
                        ["x", "c"],
                    ]);
                });
            });
            describe("4 levels deep, great-grandparent required, pass-through chain before sibling rule", () => {
                // Start(required): [A(optional)->B(optional)->X(optional) "foo"] then [C(optional) "bar"]
                // Start's required mode governs even though all intermediates are optional.
                const g = `
                    <X> [spacing=optional] = foo -> "x";
                    <B> [spacing=optional] = $(x:<X>) -> x;
                    <A> [spacing=optional] = $(b:<B>) -> b;
                    <C> [spacing=optional] = bar -> "c";
                    <Start> [spacing=required] = $(a:<A>) $(c:<C>) -> [a, c];
                `;
                const grammar = loadGrammarRules("test.grammar", g);
                it("matches with space", () => {
                    expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([
                        ["x", "c"],
                    ]);
                });
                it("does not match without space (Start required governs)", () => {
                    expect(testMatchGrammar(grammar, "foobar")).toStrictEqual(
                        [],
                    );
                });
            });
        });
    });
});
