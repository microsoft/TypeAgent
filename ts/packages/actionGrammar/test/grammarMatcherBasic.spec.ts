// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { escapedSpaces, spaces, testMatchGrammar } from "./testUtils.js";

describe("Grammar Matcher - Basic", () => {
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
