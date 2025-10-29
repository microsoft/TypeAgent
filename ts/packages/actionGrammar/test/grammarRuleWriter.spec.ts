// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseGrammarRules,
    expressionsSpecialChar,
} from "../src/grammarRuleParser.js";
import { writeGrammarRules } from "../src/grammarRuleWriter.js";
import { escapedSpaces, spaces } from "./testUtils.js";

function validateRoundTrip(grammar: string) {
    const rules = parseGrammarRules("orig", grammar, false);
    const str = writeGrammarRules(rules);
    const parsed = parseGrammarRules("test", str, false);
    expect(parsed).toStrictEqual(rules);
}

describe("Grammar Rule Writer", () => {
    it("simple", () => {
        validateRoundTrip(`@<test> = hello world`);
    });
    it("alternates", () => {
        validateRoundTrip(`@<test> = hello | world | again`);
    });
    it("multiple rules", () => {
        validateRoundTrip(`
            @<test> = hello | world | again
            @<other> = one two three
        `);
    });
    it("rule reference", () => {
        validateRoundTrip(`
            @<test> = hello <other> world
            @<other> = one two three
        `);
    });
    it("optional rule reference", () => {
        validateRoundTrip(`
            @<test> = hello (<other>)? world
            @<other> = one | two | three
        `);
    });
    it("spaces in expressions", () => {
        validateRoundTrip(
            `@<test> = ${spaces}${escapedSpaces}${spaces}${escapedSpaces}${spaces}`,
        );
    });
    it("special characters in expressions", () => {
        validateRoundTrip(
            `@<test> = ${expressionsSpecialChar.map((c) => `\\${c}`).join("")}`,
        );
    });
    it("with string value", () => {
        validateRoundTrip(`@<test> = hello -> "greeting"`);
    });

    it("with boolean value", () => {
        validateRoundTrip(`@<test> = hello -> true`);
    });
    it("with number value", () => {
        validateRoundTrip(`@<test> = hello -> -12.3e+2`);
    });

    it("with object value", () => {
        validateRoundTrip(`@<test> = hello -> { b: true, n: 12, s: "string" }`);
    });
    it("with array value", () => {
        validateRoundTrip(`@<test> = hello -> [true, 34.3, "string"]`);
    });
    it("with nested value", () => {
        validateRoundTrip(
            `@<test> = hello -> { b: true, n: 12, s: "string", a: [1, 2, { o: "z" }], o: { x: [] } }`,
        );
    });
    it("with variable", () => {
        validateRoundTrip(
            `@<test> = hello $(x) world -> { "type": "test", "var": $(x) }`,
        );
    });
    it("with number variable", () => {
        validateRoundTrip(
            `@<test> = hello $(x: number) world -> { "type": "test", "var": $(x) }`,
        );
    });
    it("with rules reference variable", () => {
        validateRoundTrip(`@<test> = hello $(x:<other>) world -> { "type": "test", "var": $(x) }
            @<other> = one -> 1 | two ->2 | three -> 3`);
    });
    it("with optional variable", () => {
        validateRoundTrip(
            `@<test> = hello $(x: number)? world -> { "type": "test", "var": $(x) }`,
        );
    });
});
