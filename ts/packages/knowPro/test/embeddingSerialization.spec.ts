// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    deserializeEmbeddings,
    serializeEmbeddings,
} from "../src/fuzzyIndex.js";

describe("binary float32 embedding codec", () => {
    test("serializes only a typed-array view using little-endian bytes", () => {
        const backing = new Float32Array([999, 0.25, -0, -999]);
        const view = backing.subarray(1, 3);
        const bytes = serializeEmbeddings([view]);
        expect(bytes.length).toBe(8);
        expect(bytes.readFloatLE(0)).toBe(0.25);
        expect(Object.is(bytes.readFloatLE(4), -0)).toBe(true);
        const unaligned = Buffer.concat([Buffer.from([1]), bytes]).subarray(1);
        const loaded = deserializeEmbeddings(unaligned, 2);
        expect(loaded).toEqual([view]);
        loaded[0][0] = 0;
        expect(bytes.readFloatLE(0)).toBe(0.25);
        expect(backing[1]).toBe(0.25);
    });

    test("empty artifacts and finite values roundtrip", () => {
        expect(serializeEmbeddings([])).toEqual(Buffer.alloc(0));
        expect(deserializeEmbeddings(Buffer.alloc(0), 2)).toEqual([]);
        const vectors = [
            new Float32Array([Number.MIN_VALUE, 1 / 3]),
            new Float32Array([-12, 42]),
        ];
        expect(deserializeEmbeddings(serializeEmbeddings(vectors), 2)).toEqual(
            vectors,
        );
    });

    test.each([0, -1, 1.5, NaN, Infinity])(
        "rejects dimension %s",
        (dimension) => {
            expect(() =>
                deserializeEmbeddings(Buffer.alloc(0), dimension),
            ).toThrow("dimensions");
        },
    );

    test("rejects incomplete, mixed-dimension and non-finite vectors", () => {
        expect(() => deserializeEmbeddings(Buffer.alloc(7), 2)).toThrow(
            "incomplete",
        );
        expect(() => serializeEmbeddings([new Float32Array()])).toThrow(
            "dimensions",
        );
        expect(() =>
            serializeEmbeddings([
                new Float32Array([1]),
                new Float32Array([1, 2]),
            ]),
        ).toThrow("equal dimensions");
        expect(() =>
            serializeEmbeddings([new Float32Array([Infinity])]),
        ).toThrow("non-finite");
        const invalid = Buffer.alloc(4);
        invalid.writeFloatLE(NaN);
        expect(() => deserializeEmbeddings(invalid, 1)).toThrow("non-finite");
    });
});
