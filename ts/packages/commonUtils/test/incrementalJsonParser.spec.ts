// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createIncrementalJsonParser } from "../src/incrementalJsonParser.js";

const testInput: [string, any][] = [
    ["true", true],
    ["false", false],
    ["null", null],
    ["number", -123],
    ["string", "abc"],
    ["array", [1, 2, 3]],
    ["object", { a: 1, b: 2e-34, c: -3.14 }],
    ["nested", { a: { b: { c: { d: 1 } } } }],
    ["array nested", [{ a: { b: { c: { d: [1, 2, 3] } } } }]],
    ["empty array", []],
    ["empty object", {}],
    ["empty string", ""],
];

const space = " \t\n\r";
const stringifiedTestInput = [
    ...testInput.map(
        ([name, input]) => [name, JSON.stringify(input)] as [string, string],
    ),
    ["escaped", '{"a":"a\\b\\f\\r\\t\\n\\"\\u1234\\\\\\/"}'],
    [
        "space",
        `${space}{${space}"a"${space}:${space}[${space}-1.323e-123${space},${space}2234${space}]${space},${space}"b"${space}:${space}"a"${space}}${space}`,
    ],
];
describe("Incremental Json Parser", () => {
    describe.each(["full", "leaf"])("%s", (mode) => {
        it.each(stringifiedTestInput)("%s", (name, input) => {
            const inputParsed = JSON.parse(input);
            function countProps(obj: any): number {
                if (obj === null || typeof obj !== "object") {
                    return 1;
                }
                let count = mode === "full" ? 1 : 0;
                for (const value of Object.values(obj)) {
                    count += countProps(value);
                }
                return count;
            }

            let called = 0;
            const cb = (prop: string, value: any) => {
                called++;
                if (mode === "leaf") {
                    if (value !== null) {
                        expect(typeof value).not.toBe("object");
                    }
                }
                let inputValue = inputParsed;
                if (prop !== "") {
                    const props = prop.split(".");
                    for (const p of props) {
                        inputValue = inputValue[p];
                    }
                }
                expect(value).toEqual(inputValue);
            };
            const parser = createIncrementalJsonParser(
                cb,
                mode === "full"
                    ? {
                          full: true,
                      }
                    : undefined,
            );
            parser.parse(input);
            const result = parser.complete();
            expect(result).toBe(true);
            expect(called).toBe(countProps(inputParsed));
        });
    });
});
