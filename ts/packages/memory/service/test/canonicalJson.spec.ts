// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    canonicalJson,
    canonicalJsonValue,
    codePointOrder,
} from "../src/canonicalJson.js";

describe("canonicalJson", () => {
    it("serializes equal values identically regardless of key order", () => {
        expect(
            canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: 3 } }),
        ).toBe(canonicalJson({ a: { c: 3, d: [2, { x: 2, y: 1 }] }, b: 1 }));
    });

    it("sorts keys with en collation by default", () => {
        // Code-point order would put "aZ" first.
        expect(
            Object.keys(canonicalJsonValue({ aZ: 1, ab: 2 }) as object),
        ).toEqual(["ab", "aZ"]);
    });

    it("sorts keys in code-point order when requested", () => {
        expect(
            Object.keys(
                canonicalJsonValue(
                    { ab: 1, aZ: 2 },
                    { keyOrder: codePointOrder },
                ) as object,
            ),
        ).toEqual(["aZ", "ab"]);
    });

    it("keeps every value when mapped keys collide", () => {
        expect(
            canonicalJsonValue(
                { secretA: 1, secretB: 2 },
                { mapKey: () => "[REDACTED]" },
            ),
        ).toEqual({ "[REDACTED]": 1, "[REDACTED] (2)": 2 });
    });

    it("keeps __proto__ as an own key", () => {
        const value = JSON.parse('{"__proto__": {"polluted": true}}');
        const result = canonicalJsonValue(value) as Record<string, unknown>;
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
        expect(canonicalJson(value)).toBe('{"__proto__":{"polluted":true}}');
    });
});
