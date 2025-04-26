// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getStringChunks } from "../src/lib/index.js";

describe("collections.strings", () => {
    test("chunks", () => {
        const strings: string[] = [];
        strings.push("1".repeat(10));
        strings.push("2".repeat(10));

        let chunks = [...getStringChunks(strings, 2, 20)];
        expect(chunks).toHaveLength(1);
        expect(totalCharsInChunks(chunks)).toEqual(totalChars(strings));

        strings.push("3".repeat(10));
        chunks = [...getStringChunks(strings, 2, 20)];
        expect(chunks).toHaveLength(2);
        expect(totalCharsInChunks(chunks)).toEqual(totalChars(strings));

        strings.push("4".repeat(7));
        strings.push("5".repeat(7));
        // 44 chars so far
        chunks = [...getStringChunks(strings, 2, 20)];
        expect(chunks).toHaveLength(3);
        expect(totalCharsInChunks(chunks)).toEqual(totalChars(strings));

        chunks = [...getStringChunks(strings, 3, 15)];
        expect(chunks).toHaveLength(4);
        expect(totalCharsInChunks(chunks)).toEqual(totalChars(strings));

        strings.push("6".repeat(1));
        // 45 chars, 6 strings
        chunks = [...getStringChunks(strings, 3, 15)];
        expect(chunks).toHaveLength(4);
        expect(totalCharsInChunks(chunks)).toEqual(totalChars(strings));

        strings.push("7".repeat(5));
        chunks = [...getStringChunks(strings, 3, 15)];
        expect(chunks).toHaveLength(5);
        expect(totalCharsInChunks(chunks)).toEqual(totalChars(strings));
    });

    function totalChars(strings: string[]): number {
        return strings.reduce((acc, str) => acc + str.length, 0);
    }

    function totalCharsInChunks(chunks: string[][]): number {
        let total = 0;
        for (const chunk of chunks) {
            for (const str of chunk) {
                total += str.length;
            }
        }
        return total;
    }
});
