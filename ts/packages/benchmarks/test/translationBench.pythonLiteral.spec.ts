// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import {
    PythonNumber,
    parsePythonLiteral,
    parsePythonLiteralAt,
} from "../src/translationBench/index.js";

describe("Python literals", () => {
    it("parses the supported dataset values", () => {
        expect(
            parsePythonLiteral(
                `{'text': 'line\\n', "items": [True, False, None, -1.25e+3,],}`,
            ),
        ).toEqual({ text: "line\n", items: [true, false, null, -1250] });
        expect(parsePythonLiteral(`'\\U0001f600'`)).toBe("😀");
        expect(parsePythonLiteral("[1e10, 101.0]")).toEqual([1e10, 101]);
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
        const object = parsePythonLiteral("{'__proto__': True}") as Record<
            string,
            unknown
        >;
        expect(Object.getPrototypeOf(object)).toBeNull();
        expect(object.__proto__).toBe(true);
        expect(() => parsePythonLiteral("9007199254740992")).toThrow(
            /preserve/,
        );
        expect(() => parsePythonLiteral("1e309")).toThrow(/preserve/);
        expect(() => parsePythonLiteral(`'\\U00110000'`)).toThrow(SyntaxError);
        expect(() => parsePythonLiteral(`'\\U00110000'`)).toThrow(
            /invalid Python string escape/,
        );
        expect(() => parsePythonLiteral("True trailing")).toThrow(/trailing/);
        expect(() => parsePythonLiteral("[[None]]", { maxDepth: 1 })).toThrow(
            /maxDepth/,
        );
        expect(() =>
            parsePythonLiteral("'abc'", { maxStringLength: 2 }),
        ).toThrow(/maxStringLength/);
    });
});
