// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import {
    PythonNumber,
    parsePythonLiteral as parse,
    parsePythonLiteralAt,
} from "../src/translationBench/index.js";

describe("Python literals", () => {
    it("parses the supported dataset values", () => {
        expect(
            parse(
                `{'text': 'line\\n', "items": [True, False, None, -1.25e+3,],}`,
            ),
        ).toEqual({ text: "line\n", items: [true, false, null, -1250] });
        expect(parse(`'\\U0001f600'`)).toBe("😀");
        expect(parse("[1e10, 101.0]")).toEqual([1e10, 101]);
    });

    it("supports offsets and preserved number lexemes", () => {
        expect(
            parsePythonLiteralAt("prefix 1e309 suffix", {
                offset: 7,
                preserveNumberLexemes: true,
            }),
        ).toEqual({ value: new PythonNumber("1e309"), end: 12 });
    });

    it("rejects unsafe input and enforces bounds", () => {
        const object = parse("{'__proto__': True}") as Record<string, unknown>;
        expect(Object.getPrototypeOf(object)).toBeNull();
        expect(object.__proto__).toBe(true);
        expect(() => parse("9007199254740992")).toThrow(/preserve/);
        expect(() => parse("1e309")).toThrow(/preserve/);
        const invalidEscape = () => parse(`'\\U00110000'`);
        expect(invalidEscape).toThrow(SyntaxError);
        expect(invalidEscape).toThrow(/invalid Python string escape/);
        expect(() => parse("True trailing")).toThrow(/trailing/);
        expect(() => parse("[[None]]", { maxDepth: 1 })).toThrow(/maxDepth/);
        expect(() => parse("'a'", { maxStringLength: 0 })).toThrow(
            /maxStringLength/,
        );
    });
});
