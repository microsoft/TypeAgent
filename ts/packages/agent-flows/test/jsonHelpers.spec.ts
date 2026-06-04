// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { tryParseJsonArray, parseOptionalJsonArray } from "../src/index.js";

describe("jsonHelpers", () => {
    describe("tryParseJsonArray (strict)", () => {
        test("undefined input is treated as missing (ok + undefined)", () => {
            expect(tryParseJsonArray(undefined, "tags")).toEqual({
                ok: true,
                value: undefined,
            });
        });

        test("array input passes through unchanged", () => {
            const arr = [1, 2, 3];
            expect(tryParseJsonArray(arr, "tags")).toEqual({
                ok: true,
                value: arr,
            });
        });

        test("JSON-encoded array string is parsed", () => {
            expect(tryParseJsonArray('["a","b"]', "tags")).toEqual({
                ok: true,
                value: ["a", "b"],
            });
        });

        test("non-string non-array primitive is a hard failure", () => {
            const result = tryParseJsonArray(42, "tags");
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toMatch(/tags/);
                expect(result.error).toMatch(/number/);
            }
        });

        test("malformed JSON string is a hard failure with diagnostic", () => {
            const result = tryParseJsonArray("not json", "params");
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toMatch(/params/);
                expect(result.error).toMatch(/invalid JSON/i);
            }
        });

        test("JSON that parses but isn't an array is a hard failure", () => {
            const result = tryParseJsonArray('{"a":1}', "params");
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toMatch(/params/);
                expect(result.error).toMatch(/array/i);
            }
        });

        test("JSON 'null' is reported as not-an-array with null in the message", () => {
            const result = tryParseJsonArray("null", "params");
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toMatch(/null/);
            }
        });
    });

    describe("parseOptionalJsonArray (permissive)", () => {
        test("undefined → undefined", () => {
            expect(parseOptionalJsonArray(undefined)).toBeUndefined();
        });

        test("array passes through", () => {
            const arr = ["x"];
            expect(parseOptionalJsonArray(arr)).toBe(arr);
        });

        test("JSON array string is parsed", () => {
            expect(parseOptionalJsonArray('["a","b"]')).toEqual(["a", "b"]);
        });

        test("non-string non-array is silently dropped", () => {
            expect(parseOptionalJsonArray(42)).toBeUndefined();
            expect(parseOptionalJsonArray({ a: 1 })).toBeUndefined();
        });

        test("malformed JSON string is silently dropped", () => {
            expect(parseOptionalJsonArray("not json")).toBeUndefined();
        });

        test("JSON object string is silently dropped", () => {
            expect(parseOptionalJsonArray('{"a":1}')).toBeUndefined();
        });
    });
});
