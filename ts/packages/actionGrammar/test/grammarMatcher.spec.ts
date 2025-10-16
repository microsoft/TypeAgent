// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammar } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { escapedSpaces, spaces } from "./testUtils.js";

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
            const g = `@<Start> = hello world -> ${JSON.stringify(v)}`;
            const grammar = loadGrammar("test.grammar", g);
            const match = matchGrammar(grammar, "hello world");
            expect(match).toStrictEqual([v]);
        });
    });
    describe("Basic Match", () => {
        const g = `@<Start> = hello world -> true`;
        const grammar = loadGrammar("test.grammar", g);

        it("space prefix", () => {
            expect(matchGrammar(grammar, `${spaces}hello world`)).toStrictEqual(
                [true],
            );
        });
        it("space infix", () => {
            expect(matchGrammar(grammar, `hello${spaces}world`)).toStrictEqual([
                true,
            ]);
        });
        it("space suffix", () => {
            expect(matchGrammar(grammar, `hello world${spaces}`)).toStrictEqual(
                [true],
            );
        });
        it("ignore case", () => {
            expect(matchGrammar(grammar, `HELLO WORLD`)).toStrictEqual([true]);
        });
    });
    describe("Escaped Match", () => {
        it("escaped space prefix", () => {
            const g = `@<Start> = ${escapedSpaces}hello world -> true`;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, `${spaces}hello world`)).toStrictEqual(
                [true],
            );
        });
        it("escaped space prefix - alt space", () => {
            const g = `@<Start> = ${escapedSpaces}hello world -> true`;
            const grammar = loadGrammar("test.grammar", g);
            expect(
                matchGrammar(grammar, `${spaces}hello\tworld`),
            ).toStrictEqual([true]);
        });
        it("escaped space prefix - extra space", () => {
            const g = `@<Start> = ${escapedSpaces}hello world -> true`;
            const grammar = loadGrammar("test.grammar", g);
            expect(
                matchGrammar(grammar, ` ${spaces}hello \nworld`),
            ).toStrictEqual([true]);
        });
        it("escaped space - not match", () => {
            const g = `@<Start> = ${escapedSpaces}hello world -> true`;
            const grammar = loadGrammar("test.grammar", g);
            expect(
                matchGrammar(grammar, `${spaces} hello world`),
            ).toStrictEqual([]);
        });
        it("escaped space infix", () => {
            const g = `@<Start> = hello${escapedSpaces} world -> true`;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, `hello${spaces} world`)).toStrictEqual(
                [true],
            );
        });
        it("escaped space infix - extra space", () => {
            const g = `@<Start> = hello${escapedSpaces} world -> true`;
            const grammar = loadGrammar("test.grammar", g);
            expect(
                matchGrammar(grammar, `hello${spaces} \r\vworld`),
            ).toStrictEqual([true]);
        });
        it("escaped space infix - not match", () => {
            const g = `@<Start> = hello${escapedSpaces} world -> true`;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, `hello${spaces}world`)).toStrictEqual(
                [],
            );
            expect(
                matchGrammar(grammar, `hello ${spaces} world`),
            ).toStrictEqual([]);
        });
        it("escaped space infix - no space", () => {
            const g = `@<Start> = hello${escapedSpaces}world -> true`;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, `hello${spaces}world`)).toStrictEqual([
                true,
            ]);
            expect(
                matchGrammar(grammar, `hello ${spaces} world`),
            ).toStrictEqual([]);
        });
    });
    describe("Variable Match", () => {
        it("simple variable - explicit string", () => {
            const g = `@<Start> = $(x:string) -> $(x)`;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "value")).toStrictEqual(["value"]);
        });
        it("simple variable - explicit type name", () => {
            const g = `@<Start> = $(x:TrackName) -> $(x)`;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "value")).toStrictEqual(["value"]);
        });
        it("simple variable - implicit string", () => {
            const g = `@<Start> = $(x) -> $(x)`;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "value")).toStrictEqual(["value"]);
        });
        it("simple variable - simple integer", () => {
            const g = `@<Start> = $(x:number) -> $(x)`;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "1234")).toStrictEqual([1234]);
        });
        it("simple variable - minus integer", () => {
            const g = `@<Start> = $(x:number) -> $(x)`;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "-1234")).toStrictEqual([-1234]);
        });
        it("simple variable - plus integer", () => {
            const g = `@<Start> = $(x:number) -> $(x)`;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "+1234")).toStrictEqual([1234]);
        });
        it("simple variable - float", () => {
            const g = `@<Start> = $(x:number) -> $(x)`;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "10.123")).toStrictEqual([10.123]);
        });

        it("simple variable - negative float", () => {
            const g = `@<Start> = $(x:number) -> $(x)`;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "-02120.123")).toStrictEqual([
                -2120.123,
            ]);
        });
        it("simple variable - float with exponent", () => {
            const g = `@<Start> = $(x:number) -> $(x)`;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "45.678e-9")).toStrictEqual([
                45.678e-9,
            ]);
        });
        it("space around variable - string", () => {
            const g = `@<Start> = hello $(x) world -> $(x)`;
            const grammar = loadGrammar("test.grammar", g);
            expect(
                matchGrammar(grammar, `hello${spaces}value${spaces}world`),
            ).toStrictEqual(["value"]);
        });
        it("space around variable - number", () => {
            const g = `@<Start> = hello $(x:number) world -> $(x)`;
            const grammar = loadGrammar("test.grammar", g);
            expect(
                matchGrammar(grammar, `hello${spaces}123${spaces}world`),
            ).toStrictEqual([123]);
        });
        it("multiple", () => {
            const g = `
                @<Start> = $(x:number) -> $(x)
                @<Start> = $(x) -> $(x)`;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "13.348")).toStrictEqual([
                13.348,
                "13.348",
            ]);
        });
        it("nested rules", () => {
            const g = `
            @<Start> = $(x:<Hello>) $(y:<World>) -> { hello: $(x), world: $(y) }
            @<Hello> = hello -> "hello"
            @<World> = world -> "world"
            `;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "hello world")).toStrictEqual([
                { hello: "hello", world: "world" },
            ]);
        });
        it("nested rules - default value", () => {
            const g = `
            @<Start> = <Hello>
            @<Hello> = hello -> "first"
            @<Hello> = hello -> "second"
            `;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "hello")).toStrictEqual([
                "first",
                "second",
            ]);
        });
        it("nested rules - default value with str expr", () => {
            const g = `
            @<Start> = A <Hello> world
            @<Hello> = hello -> "first"
            @<Hello> = hello -> "second"
            `;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "a hello world")).toStrictEqual([
                "first",
                "second",
            ]);
        });

        it("wildcard ", () => {
            const g = `
            @<Start> = hello $(x) world            
            `;
            const grammar = loadGrammar("test.grammar", g);
            expect(
                matchGrammar(grammar, "hello this is a test world"),
            ).toStrictEqual(["this is a test"]);
        });
        it("wildcard at end of nested rule", () => {
            const g = `
            @<Start> = <Hello> world
            @<Hello> = hello $(x)
            `;
            const grammar = loadGrammar("test.grammar", g);
            expect(
                matchGrammar(grammar, "hello   this is a test   world"),
            ).toStrictEqual(["this is a test"]);
        });

        it("wildcard at before the nested rule", () => {
            const g = `
            @<Start> = hello $(x) <World>
            @<World> = world
            `;
            const grammar = loadGrammar("test.grammar", g);
            expect(
                matchGrammar(grammar, "hello   this is a test   world"),
            ).toStrictEqual(["this is a test"]);
        });

        it("wildcard alternates", () => {
            const g = `@<Start> = $(x) by $(y) -> [$(x), $(y)]`;
            const grammar = loadGrammar("test.grammar", g);
            expect(
                matchGrammar(grammar, "song by the sea by Bach"),
            ).toStrictEqual([
                ["song", "the sea by Bach"],
                ["song by the sea", "Bach"],
            ]);
        });
    });
    describe("Not matched", () => {
        it("string expr not separated", () => {
            const g = `
            @<Start> = hello world -> true            
            `;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "helloworld")).toStrictEqual([]);
        });
        it("sub-string expr not separated", () => {
            const g = `
            @<Start> = <hello> <world> -> true            
            @<hello> = hello
            @<world> = world
            `;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "helloworld")).toStrictEqual([]);
        });
        it("trailing text", () => {
            const g = `
            @<Start> = hello world -> true            
            `;
            const grammar = loadGrammar("test.grammar", g);
            expect(matchGrammar(grammar, "hello world more")).toStrictEqual([]);
        });
    });
});
