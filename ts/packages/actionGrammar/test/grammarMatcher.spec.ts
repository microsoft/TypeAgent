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
        it("escaped space infix - not match", () => {
            const g = `<Start> = hello${escapedSpaces} world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(
                testMatchGrammar(grammar, `hello${spaces}world`),
            ).toStrictEqual([]);
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
            expect(testMatchGrammar(grammar, "hello world world")).toStrictEqual(
                [true],
            );
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
            expect(testMatchGrammar(grammar, "hello world world")).toStrictEqual(
                [true],
            );
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
});
